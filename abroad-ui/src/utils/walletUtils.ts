import * as StellarSdk from '@stellar/stellar-sdk';

// USDC constants for Stellar mainnet
export const USDC_ASSET_CODE = 'USDC';
export const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/**
 * Format wallet address for display
 */
export const formatWalletAddress = (address: string | null, connectedText = 'Connected', notConnectedText = 'No conectado') => {
  if (!address) return notConnectedText;
  if (address === 'Connected') return connectedText;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * Fetch USDC balance from Stellar network
 */
export const fetchUSDCBalance = async (stellarAddress: string): Promise<string> => {
  try {
    const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
    const account = await server.loadAccount(stellarAddress);
    
    const usdcBalance = account.balances.find((balance: StellarSdk.Horizon.HorizonApi.BalanceLine) => {
      if (balance.asset_type === 'credit_alphanum4') {
        return balance.asset_code === USDC_ASSET_CODE && balance.asset_issuer === USDC_ISSUER;
      }
      return false;
    });
    
    if (usdcBalance) {
      const numericBalance = parseFloat(usdcBalance.balance);
      return numericBalance.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
    } else {
      return '0.00';
    }
  } catch (error) {
    console.error('Error fetching USDC balance:', error);
    return '0.00';
  }
};
