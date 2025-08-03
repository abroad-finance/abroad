import { challenge, refresh, verify } from "../api";

export async function walletAuth(address: string, signer: { signMessage: (msg: string) => Promise<string> }): Promise<string> {
  const res = await challenge({ address });
  if (res.status !== 200) throw new Error('Failed to fetch challenge');
  const { xdr } = await res.data;
  const signature = await signer.signMessage(xdr);
  const verifyRes = await verify({ address, signedXDR: signature });
  if (verifyRes.status !== 200) throw new Error('Failed to verify signature');
  const { token } = await verifyRes.data;
  return token as string;
}

export async function refreshWalletAuthToken(token: string): Promise<string> {
  const res = await refresh({ token })
  if (res.status !== 200) throw new Error("Failed to refresh token");
  return res.data.token as string;
}
