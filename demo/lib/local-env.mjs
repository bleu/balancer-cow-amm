import { ASSETS, lower } from "./shared.mjs";
// Only public fixture configuration is written; wallet private keys are never exported.
export function localFixtureEnv(state, rpcUrl, curatorAddress) {
  const assets = state.tokens.map((t, i) => ({
    ...ASSETS[i],
    address: t.address,
    decimals: t.decimals,
  }));
  return {
    DEMO_CHAIN_ID: "31338",
    DEMO_NETWORK_NAME: "Local Anvil",
    DEMO_LOCAL_DEV: "true",
    RPC_URL: rpcUrl,
    DEMO_EXPLORER_URL: "",
    DEMO_FACTORY_ADDRESS: state.factory,
    CURATOR_ADDRESS: curatorAddress,
    CURATOR_LIVE: "false",
    DEMO_POOLS: JSON.stringify([
      { address: state.pool, name: "MAG7 · local fixture" },
    ]),
    CURATOR_POOLS: "[]",
    DEMO_LOCAL_ASSETS: JSON.stringify(assets),
    DEMO_FIXTURE_PRICES: JSON.stringify(
      Object.fromEntries(
        assets.map((a, i) => [lower(a.address), i === 0 ? 1.1 : 1])
      )
    ),
  };
}
export function serializeEnv(env) {
  return (
    Object.entries(env)
      .map(([key, value]) => {
        // Select a quote delimiter absent from the value so dotenv preserves JSON exactly.
        const quote = ["'", '"', "`"].find((q) => !value.includes(q));
        if (!quote || /[\r\n]/.test(value))
          throw Error("Cannot serialize local environment");
        return `${key}=${quote}${value}${quote}`;
      })
      .join("\n") + "\n"
  );
}
