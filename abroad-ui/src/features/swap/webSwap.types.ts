export interface SwapData {
  quote_id: string;
  srcAmount: string;
  tgtAmount: string;
}

// Define a proper type for the user object instead of using `any`
export interface BluxUser {
  publicKey: string;
  // Add other user properties as needed
}

export type SwapView = 'swap' | 'bankDetails';