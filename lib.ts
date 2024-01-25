import {
  FederatedInstances,
  FollowCommunity,
  LemmyHttp as LemmyHttp19,
  CommunityAggregates as CommunityAggregates19,
} from "lemmy-js-client_19";
import { LemmyHttp as LemmyHttp18 } from "lemmy-js-client_18";
import { LocalCommunity, LocalUser, communityDb, instanceDb } from "./database";
import { AppError } from "./error";

export const HEADERS = {
  "User-Agent": "lcb-bot/1.0.0",
};

// LemmyHttp18 wants jwt in function calls but it doesn't included in itself like 19. So I extended it to be able add jwt in every request.
class LemmyHttp18WithJWT extends LemmyHttp18 {
  jwt: string;
  constructor(jwt: string, ...args: ConstructorParameters<typeof LemmyHttp18>) {
    super(...args);
    this.jwt = jwt;
  }
}

type LemmyHttp = LemmyHttp19 | LemmyHttp18WithJWT;

/**
 * The logic is done here.
 */
export async function conditionalFollow({
  localUsers,
  localCommunities,
}: {
  localUsers?: LocalUser[];
  localCommunities?: LocalCommunity[];
} = {}) {
  if (!localUsers) localUsers = await instanceDb.findAsync({ active: true });
  if (!localCommunities)
    localCommunities = await communityDb.findAsync({}).sort({ updatedAt: 1 });

  // Cache clients to prevent session spamming
  const clientCache = new Map<string, LemmyHttp>();
  const getClientCached = async (user: LocalUser) => {
    const cached = clientCache.get(user.host);
    if (cached) return cached;
    const client = await getClient(user);
    clientCache.set(user.host, client);
    return client;
  };
  for (const localCommunity of localCommunities) {
    const progress = localCommunity.progress;
    let progressChanged = false;
    for (const localUser of localUsers) {
      const record = progress.find((r) => r.host === localUser.host);
      if (record?.status === "done") {
        continue;
      }
      progressChanged = true;
      let status: "pending" | "done" | "error" = "pending";
      try {
        const client = await getClientCached(localUser);
        const federationStatus = await instanceFederationStatus(
          client,
          localUser.host,
          localCommunity.host
        );
        if (federationStatus === "blocked") {
          status = "done";
          continue;
        }
        const community = await getCommunity(
          client,
          `${localCommunity.name}@${localCommunity.host}`
        );

        // subscribers_local for ^0.19, subscribers for 0.18
        const localSubscribers =
          client instanceof LemmyHttp19
            ? (community.counts as CommunityAggregates19).subscribers_local
            : community.counts.subscribers;
        if (
          localSubscribers > (community.subscribed === "NotSubscribed" ? 0 : 1)
        ) {
          // Unfollow if there are other followers than the bot
          await followCommunity(client, {
            community_id: community.community.id,
            follow: false,
          });
          status = "done";
          continue;
        } else if (community.subscribed === "NotSubscribed") {
          // Subscribe to the community if not subscribed
          await followCommunity(client, {
            community_id: community.community.id,
            follow: true,
          });
          status = "pending";
        } else if (community.subscribed === "Pending") {
          // Unsubscribe if stuck pending and let next iteration to subscribe
          await followCommunity(client, {
            community_id: community.community.id,
            follow: false,
          });
          status = "error";
        }
      } catch (e) {
        console.error(
          `Error while checking !${localCommunity.name}@${localCommunity.host} with @${localUser.username}@${localUser.host}:`,
          e
        );
        status = "error";
      } finally {
        const record = progress.findIndex((r) => r.host === localUser.host);
        if (record === -1) {
          progress.push({ host: localUser.host, status });
        } else {
          progress[record] = { host: localUser.host, status };
        }
      }
    }
    if (progressChanged) {
      await communityDb.updateAsync(
        { host: localCommunity.host, name: localCommunity.name },
        { $set: { progress, updatedAt: new Date() } }
      );
    }
  }
}

export async function getClient(
  user: Partial<LocalUser> & { host: string }
): Promise<LemmyHttp> {
  const nodeInfo = await getNodeInfo(user.host);
  const version = nodeInfo?.software?.version;
  let client;
  if (version?.startsWith("0.18")) {
    client = new LemmyHttp18(`https://${user.host}`, { headers: HEADERS });
  } else {
    client = new LemmyHttp19(`https://${user.host}`, { headers: HEADERS });
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
      ...HEADERS,
    });
  } else if (jwt && client instanceof LemmyHttp18) {
    client = new LemmyHttp18WithJWT(jwt, `https://${user.host}`, {
      headers: HEADERS,
    });
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
  const nodeInfo = await fetch(`https://${host}/nodeinfo/2.0.json`, {
    headers: HEADERS,
  }).then((r) => r.json());
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

export async function fediseerStatus(
  host: string
): Promise<{ guarantees: number; censures: number }> {
  try {
    const guarantees = await fetch(
      `https://fediseer.com/api/v1/guarantees/${host}?domains=true`,
      { headers: HEADERS }
    ).then((r) => r.json());
    const censures = await fetch(
      `https://fediseer.com/api/v1/censures/${host}?domains=true`,
      { headers: HEADERS }
    ).then((r) => r.json());

    if (!guarantees?.domains) {
      throw new AppError(
        `Error while fetching guarantor ${host} from Fediseer`
      );
    } else if (!censures?.domains) {
      throw new AppError(`Error while fetching censures ${host} from Fediseer`);
    }
    return {
      guarantees: guarantees.domains.length,
      censures: censures.domains.length,
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      `Error while fetching status of ${host} from Fediseer: ` +
        (e instanceof Error ? e?.message : e)
    );
  }
}

type FederationStatus = "linked" | "allowed" | "blocked";
const FEDERATION_STATUS_CACHE = new Map<
  string,
  {
    list: FederatedInstances;
    date: Date;
  }
>();
export async function instanceFederationStatus(
  client: LemmyHttp,
  host: string,
  targetHost: string
): Promise<FederationStatus> {
  const cached = FEDERATION_STATUS_CACHE.get(host);
  let response: FederatedInstances | undefined;
  // keep cache for 1 hour
  if (cached && cached.date.getTime() + 1000 * 60 * 60 > Date.now()) {
    response = cached.list;
  } else {
    if (client instanceof LemmyHttp18)
      response = (await client.getFederatedInstances({ auth: client.jwt }))
        .federated_instances;
    else response = (await client.getFederatedInstances()).federated_instances;
    if (!response) {
      throw new AppError(
        `Error while fetching federated instances from ${host}`
      );
    }
    FEDERATION_STATUS_CACHE.set(host, { list: response, date: new Date() });
  }
  if (response.linked.some((i) => i.domain === targetHost)) return "linked";
  if (response.allowed.some((i) => i.domain === targetHost)) return "allowed";
  if (response.blocked.some((i) => i.domain === targetHost)) return "blocked";
  return "allowed";
}
