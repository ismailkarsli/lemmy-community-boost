import Fastify from "fastify";
import view from "@fastify/view";
import formBody from "@fastify/formbody";
import pug from "pug";
import { communityDb, instanceDb } from "./database";
import {
  conditionalFollow,
  getClient,
  getCommunity,
  fediseerStatus,
} from "./lib";
import { INTERVAL, startPeriodicCheck } from "./periodic-check";
import { AppError } from "./error";

const BLACKLISTED_INSTANCES =
  process.env.BLACKLISTED_INSTANCES?.split(",") || [];

const fastify = Fastify({
  logger: true,
});
fastify.register(view, {
  engine: {
    pug,
  },
});
fastify.register(formBody);

startPeriodicCheck();

fastify.get("/", async (_request, reply) => {
  const communities = await communityDb.findAsync({}).sort({ createdAt: -1 });
  const instances = await instanceDb.findAsync({});
  return reply.view("/index.pug", {
    instances: instances.map((i) => ({ host: i.host, username: i.username })),
    communities,
    interval: INTERVAL / 1000 / 60,
  });
});

fastify.post("/", async (request, reply) => {
  let symbol = (request.body as { community: string })?.community;
  if (!symbol) {
    return { success: false, message: "No community provided" };
  }
  symbol = symbol.trim();
  if (!symbol.includes("@") || !symbol.includes(".")) {
    return {
      success: false,
      message:
        "Invalid community name. It should be in 'community@instance' format.",
    };
  }
  const [name, host] = symbol.split("@");
  if (!name || !host) {
    return {
      success: false,
      message:
        "Invalid community name. It should be in 'community@instance' format.",
    };
  }
  const blacklist = BLACKLISTED_INSTANCES.some((i) => i === host);
  if (blacklist) {
    return {
      success: false,
      message: `Instance ${host} is blacklisted`,
    };
  }

  const status = await fediseerStatus(host);
  if (!status.guarantees || status.censures >= 3) {
    return {
      success: false,
      message: `Instance ${host} ${
        !status.guarantees
          ? "is not guaranteed"
          : "has " + status.censures + " censures"
      } on Fediseer`,
    };
  }

  // Get community to check if it exists and check its properties
  const communityView = await getCommunity(
    await getClient({ host }),
    `${name}@${host}`
  );
  const community = communityView?.community;
  if (!community) {
    return {
      success: false,
      message: `Community !${name}@${host} does not exist`,
    };
  }
  if (community.nsfw) {
    return {
      success: false,
      message: `NSFW communities are not allowed`,
    };
  }
  if (community.deleted || community.removed) {
    return {
      success: false,
      message: `Community !${name}@${host} is deleted or removed`,
    };
  }

  const exists = await communityDb.findOneAsync({ host, name });
  if (exists) {
    await communityDb.updateAsync(
      { host, name },
      { ...exists, createdAt: new Date(), updatedAt: new Date(), progress: [] }
    );
  } else {
    await communityDb.insertAsync({
      host,
      name,
      createdAt: new Date(),
      progress: [],
    });
  }

  // Initial follow
  const newRecord = await communityDb.findOneAsync({ host, name });
  await conditionalFollow({ localCommunities: [newRecord] });

  return {
    success: true,
    message: "Community successfully " + (exists ? "updated" : "added"),
    community: newRecord,
  };
});

fastify.get("/favicon.ico", async (_, reply) => reply.status(204).send());
// Error handler
fastify.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    reply.status(400).send({ success: false, message: error.message });
  } else {
    reply.status(500).send({
      success: false,
      message: "Internal server error: " + error,
    });
  }
});

fastify.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
  if (err) throw err;
  console.info(`Server is now listening on ${address}`);
});
