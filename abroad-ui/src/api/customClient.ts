import { AxiosError } from "axios";

const baseURL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance';

export const customClient = async <T>(
    url: string,
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

    let token: string | null = null;

    const tokenFromStorage = localStorage.getItem('token');
    if (tokenFromStorage) {
        token = tokenFromStorage;
        headers = {
            ...headers,
            Authorization: `Bearer ${token}`
        };
    }

    const response = await fetch(targetUrl, {
        method,
        body,
        headers
    });

    return {
        status: response.status,
        statusText: response.statusText,
        data: await response.json(),
    } as unknown as T;
};

export default customClient;

export type ErrorType<Error> = AxiosError<Error>;
export type BodyType<BodyData> = BodyData;