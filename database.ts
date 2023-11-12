// Simple and gets the job done lol
import Datastore from "@seald-io/nedb";

export interface LocalCommunity {
  host: string;
  name: string;
  progress: { host: string; status: boolean }[];
  date: Date;
}
export const communityDb = new Datastore<LocalCommunity>({
  filename: "./data/communities.db",
  autoload: true,
});

export interface LocalUser {
  host: string;
  username: string;
  password: string;
  jwt?: string;
}
export const instanceDb = new Datastore<LocalUser>({
  filename: "./data/instances.db",
  autoload: true,
});
// INSTANCE_USERS env variable is the single source of truth for the instance/users
// So we sync the database with environments variables without losing current jwt tokens at startup
// The env must be in the form of "host:username:password,host:username:password" and password must not contain a colon and commas.
const INSTANCE_USERS = process.env.INSTANCE_USERS;
if (INSTANCE_USERS) {
  (async () => {
    const newUsers = INSTANCE_USERS.split(",").map((u) => {
      const [host, username, password] = u.split(":");
      return { host, username, password };
    });
    // Clear old users
    await instanceDb.removeAsync({}, { multi: true });
    // Insert new users
    await instanceDb.insertAsync(newUsers);
  })();
}
