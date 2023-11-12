import { conditionalFollow } from "./lib";

const INTERVAL = Number(process.env.INTERVAL) || 1000 * 60 * 60; // 1 hour

export const startPeriodicCheck = async () => {
  try {
    while (true) {
      await conditionalFollow();
      await new Promise((resolve) => setTimeout(resolve, INTERVAL));
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
