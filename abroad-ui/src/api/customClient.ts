import { AxiosError } from "axios";
import { getAuth } from "firebase/auth";

const baseURL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance';
 
export const customInstance = async <T>(
  url: string,
  {
    method,
    params,
    body,
  }: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    params?: Record<string, string>;
    body?: BodyInit;
    responseType?: string;
  },
): Promise<T> => {
  let targetUrl = `${baseURL}${url}`;

  if (params) {
    targetUrl += '?' + new URLSearchParams(params);
  }

  // Firebase authentication: get ID token for Authorization header
  const auth = getAuth();
  const user = auth.currentUser;
  let token: string | null = null;
  if (user) {
    try {
      token = await user.getIdToken();
    } catch (error) {
      console.error("Error getting Firebase ID token:", error);
      throw new Error("Failed to get authentication token.");
    }
  }
  // build headers for fetch
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(targetUrl, {
    method,
    body,
    headers
  });

  return response.json();
};

export default customInstance;

export type ErrorType<Error> = AxiosError<Error>;
export type BodyType<BodyData> = BodyData;