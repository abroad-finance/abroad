import { AxiosError } from "axios";
import { getAuth } from "firebase/auth";

const baseURL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance';

export const customClient = async <T>(
    url:string,
    {
        method,
        params,
        body,
        headers = []
    }: {
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        params?: Record<string, string>;
        body?: BodyInit | null;
        responseType?: string;
        headers?: HeadersInit;
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
            if (token) {
                headers = {
                    ...headers,
                    Authorization: `Bearer ${token}`
                };
            }
        } catch (error) {
            console.error("Error getting Firebase ID token:", error);
            throw new Error("Failed to get authentication token.");
        }
    }

    const response = await fetch(targetUrl, {
        method,
        body,
        headers
    });

    return response.json();
};

export default customClient;

export type ErrorType<Error> = AxiosError<Error>;
export type BodyType<BodyData> = BodyData;