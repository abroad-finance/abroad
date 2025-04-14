export async function fetchQuote(
  apiKey: string,
  baseUrl: string,
  payload: { amount: number; target_currency: string; payment_method: string; crypto_currency: string; network: string }
) {
  const response = await fetch(`${baseUrl}quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function fetchAcceptTransaction(
  apiKey: string,
  baseUrl: string,
  payload: { quote_id: string; user_id: string; account_number: string }
) {
  const response = await fetch(`${baseUrl}transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function fetchTransactionStatus(apiKey: string, baseUrl: string, transactionReference: string) {
  const response = await fetch(`${baseUrl}transaction/${transactionReference}`, {
    headers: { 'X-API-Key': apiKey },
  });
  
  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}

export async function fetchReverseQuote(
  apiKey: string,
  baseUrl: string,
  payload: { source_amount: number; target_currency: string; payment_method: string; crypto_currency: string; network: string }
) {
  const response = await fetch(`${baseUrl}quote/reverse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}


export async function paymentsOnboard(
  apiKey: string,
  baseUrl: string,
  onboardRequest: { account: string }
){
  const response = await fetch(`${baseUrl}payments/onboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(onboardRequest),
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function initiateKYC(
  apiKey: string,
  baseUrl: string,
  kycRequest: { user_id: string }
) {
  const response = await fetch(`${baseUrl}kyc`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
      },
      body: JSON.stringify(kycRequest),
  });

  if (!response.ok) {
      const responseJson = await response.json();
      if (responseJson.reason) {
          throw new Error(responseJson.reason);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetches the list of banks available for a specific payment method
 * 
 * @param apiKey - The API key for authentication
 * @param baseUrl - The base URL of the API
 * @param paymentMethod - Optional payment method (defaults to MOVII if not provided)
 * @returns A promise that resolves to a list of banks
 */
export async function fetchBanks(
  apiKey: string,
  baseUrl: string,
  paymentMethod?: string
) {
  const queryParams = paymentMethod ? `?paymentMethod=${paymentMethod}` : '';
  const response = await fetch(`${baseUrl}payments/banks${queryParams}`, {
    headers: {
      'X-API-Key': apiKey,
    },
  });

  if (!response.ok) {
    const responseJson = await response.json();
    if (responseJson.reason) {
      throw new Error(responseJson.reason);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}
