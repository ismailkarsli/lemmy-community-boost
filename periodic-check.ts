import { conditionalFollow } from "./lib";

export const INTERVAL = Number(process.env.INTERVAL) || 1000 * 60 * 60; // 1 hour

export const startPeriodicCheck = async () => {
  try {
    // initial 60 seconds delay
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    while (true) {
      console.info("Periodic check started", new Date());
      await conditionalFollow();
      console.info("Periodic check finished", new Date());
      await new Promise((resolve) => setTimeout(resolve, INTERVAL));
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
