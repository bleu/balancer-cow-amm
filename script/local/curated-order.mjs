import { ethers } from 'ethers';

export const orderTuple = 'tuple(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance)';
export const orderTypes = {
  Order: [
    ['sellToken', 'address'], ['buyToken', 'address'], ['receiver', 'address'],
    ['sellAmount', 'uint256'], ['buyAmount', 'uint256'], ['validTo', 'uint32'],
    ['appData', 'bytes32'], ['feeAmount', 'uint256'], ['kind', 'string'],
    ['partiallyFillable', 'bool'], ['sellTokenBalance', 'string'], ['buyTokenBalance', 'string'],
  ].map(([name, type]) => ({ name, type })),
};
const poolInterface = new ethers.utils.Interface([
  'function commit(bytes32,uint256)', 'function transferFee()',
]);
const trampolineInterface = new ethers.utils.Interface([
  'function execute(tuple(address target,bytes callData,uint256 gasLimit)[] hooks)',
]);

export function buildAppData(pool, h0, buyAmount) {
  const hooks = {
    pre: [{ target: pool.toLowerCase(), callData: poolInterface.encodeFunctionData('commit', [h0, buyAmount]), gasLimit: '100000' }],
    post: [{ target: pool.toLowerCase(), callData: poolInterface.encodeFunctionData('transferFee'), gasLimit: '150000' }],
  };
  return JSON.stringify({ version: '1.6.0', appCode: 'Bleu CoW AMM', metadata: { hooks } });
}

export function hashOrder(order, chainId, settlement) {
  return ethers.utils._TypedDataEncoder.hash(
    { name: 'Gnosis Protocol', version: 'v2', chainId, verifyingContract: settlement }, orderTypes,
    { ...order, kind: 'sell', sellTokenBalance: 'erc20', buyTokenBalance: 'erc20' },
  );
}

export async function signCuratedOrder(order, pool, curator, chainId, settlement, epoch = 0) {
  const unsigned = { ...order, appData: ethers.constants.HashZero, partiallyFillable: false };
  const h0 = hashOrder(unsigned, chainId, settlement);
  const fullAppData = buildAppData(pool.address, h0, unsigned.buyAmount);
  const signedOrder = { ...unsigned, appData: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(fullAppData)) };
  const orderHash = hashOrder(signedOrder, chainId, settlement);
  const curatorSig = await curator._signTypedData(
    { name: 'Bleu CoW AMM', version: '1', chainId, verifyingContract: pool.address },
    { CuratedOrder: [{ name: 'orderHash', type: 'bytes32' }, { name: 'epoch', type: 'uint256' }] },
    { orderHash, epoch },
  );
  const signature = ethers.utils.hexConcat([pool.address,
    ethers.utils.defaultAbiCoder.encode([orderTuple, 'uint256', 'bytes'], [signedOrder, epoch, curatorSig])]);
  const hooks = JSON.parse(fullAppData).metadata.hooks;
  const interaction = (items) => ({ target: null, value: 0,
    callData: trampolineInterface.encodeFunctionData('execute', [items]) });
  const trampoline = await pool.hooksTrampoline();
  const pre = { ...interaction(hooks.pre), target: trampoline };
  const post = { ...interaction(hooks.post), target: trampoline };
  return { order: signedOrder, h0, fullAppData, orderHash, signature, pre, post };
}
