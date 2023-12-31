import { conditionalFollow } from "./lib";

export const INTERVAL = Number(process.env.INTERVAL) || 1000 * 60 * 60; // 1 hour

export const startPeriodicCheck = async () => {
  try {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL));
      console.info("Periodic check started", new Date());
      await conditionalFollow();
      console.info("Periodic check finished", new Date());
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
