// Unsubscribe from all subscriptions

import { communityDb, instanceDb } from "./database";
import { followCommunity, getClient, getCommunity } from "./lib";

(async () => {
  const instances = await instanceDb.findAsync({ active: true });
  const communities = await communityDb.findAsync({}).sort({ updatedAt: 1 });

  for (const instance of instances) {
    for (const community of communities) {
      try {
        const client = await getClient(instance);
        const remoteCommunity = await getCommunity(
          client,
          `${community.name}@${community.host}`
        );

        await followCommunity(client, {
          community_id: remoteCommunity.community.id,
          follow: false,
        });
      } catch (e) {
        console.error(e);
      }
    }
  }
})();
