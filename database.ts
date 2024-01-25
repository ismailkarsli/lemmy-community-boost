// Simple and gets the job done lol
import Datastore from "@seald-io/nedb";

export interface LocalCommunity {
  host: string;
  name: string;
  progress: { host: string; status: "pending" | "done" | "error" }[];
  createdAt: Date;
  updatedAt?: Date;
}
export const communityDb = new Datastore<LocalCommunity>({
  filename: "./data/communities.db",
  autoload: true,
});

export interface LocalUser {
  host: string;
  username: string;
  password: string;
  active: boolean;
  jwt?: string;
}
export const instanceDb = new Datastore<LocalUser>({
  filename: "./data/instances.db",
  autoload: true,
});
(async () => {
  // Reset progress of all communities
  await communityDb.updateAsync(
    {},
    { $set: { progress: [] } },
    { multi: true }
  );
  // INSTANCE_USERS env variable is the ssot for the instance/users. So we sync the database with environments variables.
  // The env must be in the form of "host:active:username:password,host:active:username:password" and password must not contain a colon and commas.
  const INSTANCE_USERS = process.env.INSTANCE_USERS;
  if (INSTANCE_USERS) {
    const newUsers = INSTANCE_USERS.split(",").map((u) => {
      const [host, active, username, password] = u.split(":");
      return { host, active: active === "true", username, password };
    });
    // Clear old users
    await instanceDb.removeAsync({}, { multi: true });
    // Insert new users
    await instanceDb.insertAsync(newUsers);
  }
})();
