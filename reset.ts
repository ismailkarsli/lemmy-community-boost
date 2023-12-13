// Unsubscribe from all subscriptions
// For some reason, it needs to be run multiple times to unsubscribe from all communities
// while sleep 10; do npx ts-node reset.ts; done

import { instanceDb } from "./database";
import { followCommunity, getClient } from "./lib";

const reset = async () => {
  const instances = await instanceDb.findAsync({});
  const promises = instances.map(async (instance) => {
    try {
      const client = await getClient(instance);
      let page = 0;
      while (true) {
        const subscriptions = await client.listCommunities({
          type_: "Subscribed",
          limit: 50,
          page: ++page,
          auth: instance.jwt,
        });
        if (subscriptions.communities.length === 0) {
          break;
        }

        for (const subscription of subscriptions.communities) {
          await followCommunity(client, {
            community_id: subscription.community.id,
            follow: false,
            // @ts-ignore
            auth: instance.jwt,
          });

          console.log(
            `${instance.host}: unsubscribed from ${subscription.community.actor_id}`
          );
        }
      }
    } catch (e) {
      console.error("error", e);
    }
  });

  await Promise.all(promises);
};

reset().then(() => {
  console.log("Done");
  process.exit(0);
});
