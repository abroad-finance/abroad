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
      throw new Error(`${responseJson.reason}`);
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
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchTransactionStatus(apiKey: string, baseUrl: string, transactionReference: string) {
  const response = await fetch(`${baseUrl}transaction/${transactionReference}`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!response.ok) {
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
      throw new Error(`${responseJson.reason}`);
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}
