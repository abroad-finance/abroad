import { ethers } from 'ethers';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export async function walletAuth(address: string, signer: { signMessage: (msg: string) => Promise<string> }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/walletAuth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error('Failed to fetch challenge');
  const { nonce } = await res.json();
  const signature = await signer.signMessage(nonce);
  const verifyRes = await fetch(`${API_BASE_URL}/walletAuth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  if (!verifyRes.ok) throw new Error('Failed to verify signature');
  const { token } = await verifyRes.json();
  return token as string;
}

