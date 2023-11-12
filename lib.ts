import { FollowCommunity, LemmyHttp as LemmyHttp19 } from "lemmy-js-client_19";
import { LemmyHttp as LemmyHttp18 } from "lemmy-js-client_18";
import { LocalCommunity, LocalUser, communityDb, instanceDb } from "./database";
import { AppError } from "./error";

// LemmyHttp18 wants jwt in function calls but it doesn't included in itself like 19. So I extended it to add jwt in every request.
class LemmyHttp18WithJWT extends LemmyHttp18 {
  jwt: string;
  constructor(jwt: string, ...args: ConstructorParameters<typeof LemmyHttp18>) {
    super(...args);
    this.jwt = jwt;
  }
}

type LemmyHttp = LemmyHttp19 | LemmyHttp18WithJWT;

/**
 * Important the logic is done here.
 * If the bot user is on 0.18, then we're gonna follow until an another normal user follows the community.
 * If the bot user is on 0.19, then we're gonna follow until a month passes. This is because this issue: https://github.com/LemmyNet/lemmy/issues/4144
 */
export async function conditionalFollow({
  localUsers,
  localCommunities,
}: {
  localUsers?: LocalUser[];
  localCommunities?: LocalCommunity[];
} = {}) {
  if (!localUsers) localUsers = await instanceDb.findAsync({});
  if (!localCommunities) localCommunities = await communityDb.findAsync({});
  for (const localCommunity of localCommunities) {
    const progress = localCommunity.progress;
    for (const localUser of localUsers) {
      let status = false;
      try {
        const client = await getClient(localUser);
        const community = await getCommunity(
          client,
          `${localCommunity.name}@${localCommunity.host}`
        );
        if (client instanceof LemmyHttp18 && community.counts.subscribers > 1) {
          // Unfollow if there are other followers than the bot
          await client.followCommunity({
            community_id: community.community.id,
            follow: false,
            auth: client.jwt,
          });
          status = true;
          continue;
        } else if (
          // Subscribe for a month instead of above
          localCommunity.date.getTime() + 1000 * 60 * 60 * 24 * 30 <
          Date.now()
        ) {
          await followCommunity(client, {
            community_id: community.community.id,
            follow: false,
          });
          status = true;
          continue;
        } else if (community.subscribed === "NotSubscribed") {
          // Subscribe to the community if not subscribed
          await followCommunity(client, {
            community_id: community.community.id,
            follow: true,
          });
        } else if (community.subscribed === "Pending") {
          // Unsubscribe if stuck pending and let next iteration to subscribe
          await followCommunity(client, {
            community_id: community.community.id,
            follow: false,
          });
        }
      } catch (e) {
        console.error(
          `Error while checking !${localCommunity.name}@${localCommunity.host} with @${localUser.username}@${localUser.host}:`,
          e
        );
        status = false;
      } finally {
        const record = progress.findIndex((r) => r.host === localUser.host);
        if (record === -1) {
          progress.push({ host: localUser.host, status });
        } else {
          progress[record] = { host: localUser.host, status };
        }
      }
    }
    await communityDb.updateAsync(
      { host: localCommunity.host, name: localCommunity.name },
      { $set: { progress } }
    );
  }
}

export async function getClient(
  user: Partial<LocalUser> & { host: string }
): Promise<LemmyHttp> {
  const nodeInfo = await getNodeInfo(user.host);
  const version = nodeInfo?.software?.version;
  let client;
  if (version?.startsWith("0.18")) {
    client = new LemmyHttp18(`https://${user.host}`);
  } else if (version?.startsWith("0.19")) {
    client = new LemmyHttp19(`https://${user.host}`);
  } else {
    throw new AppError(
      `Unsupported version: ${version}, host: ${
        user.host
      }, nodeInfo: ${JSON.stringify(nodeInfo)}`
    );
  }
  let jwt: string | undefined;
  if (user.jwt) jwt = user.jwt;
  else if (user.username && user.password) {
    jwt = (
      await client.login({
        username_or_email: user.username,
        password: user.password,
      })
    ).jwt;
    instanceDb.updateAsync(
      { host: user.host },
      { ...user, jwt },
      { upsert: true }
    );
  }
  if (jwt && client instanceof LemmyHttp19) {
    client.setHeaders({
      Authorization: `Bearer ${jwt}`,
      Cookie: `jwt=${jwt}`,
    });
  } else if (jwt && client instanceof LemmyHttp18) {
    client = new LemmyHttp18WithJWT(jwt, `https://${user.host}`);
  }
  return client as LemmyHttp;
}

interface NodeInfo {
  software: {
    name: string;
    version: string;
  };
}
// Cache node info for 1 hour to prevent spamming
const nodeInfoCache = new Map<string, { info: NodeInfo; timestamp: number }>();
async function getNodeInfo(host: string): Promise<NodeInfo> {
  const cached = nodeInfoCache.get(host);
  if (cached && cached.timestamp + 1000 * 60 * 60 > Date.now()) {
    return cached.info;
  }
  const nodeInfo = await fetch(`https://${host}/nodeinfo/2.0.json`).then((r) =>
    r.json()
  );
  nodeInfoCache.set(host, { info: nodeInfo, timestamp: Date.now() });
  return nodeInfo;
}

export async function getCommunity(client: LemmyHttp, communityName: string) {
  try {
    // First try to get community if it exists on the instance
    let response;
    if (client instanceof LemmyHttp18) {
      response = await client.getCommunity({
        name: communityName,
        auth: client.jwt,
      });
    } else {
      response = await client.getCommunity({ name: communityName });
    }
    if (response) return response.community_view;
    // If it doesn't exist, try to resolve/pull it
    let object;
    if (client instanceof LemmyHttp18) {
      object = await client.resolveObject({
        q: communityName,
        auth: client.jwt,
      });
    } else {
      object = await client.resolveObject({
        q: communityName,
      });
    }
    const community = object?.community;
    if (community) return community;
    throw new Error(`Community ${communityName} not found`);
  } catch (e) {
    throw new AppError(
      `Error while fetching community ${communityName}, ` +
        (e instanceof Error ? e?.message : e)
    );
  }
}

export async function followCommunity(
  client: LemmyHttp,
  form: FollowCommunity
) {
  try {
    if (client instanceof LemmyHttp18) {
      await client.followCommunity({ ...form, auth: client.jwt });
    } else {
      await client.followCommunity(form);
    }
  } catch (e) {
    // do smth here
    throw e;
  }
}

export async function isFediseerGuaranteed(host: string): Promise<boolean> {
  const request = await fetch(
    `https://fediseer.com/api/v1/guarantees/${host}?domains=true`
  ).then((r) => r.json());

  if (!request?.domains) {
    throw new AppError(`Error while fetching data from Fediseer`);
  }
  return Boolean(request.domains.length);
}
