// global-setup.ts
async function globalSetup() {
  // Add a delay so server can warm up
  console.log("⏳ Waiting 1 minute for server to finish loading...");
  await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
}

export default globalSetup;
