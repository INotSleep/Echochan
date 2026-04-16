import type { ResolveInput, ResolveResult } from "../contracts.js";

interface ResolverClient {
    resolve(input: ResolveInput): Promise<ResolveResult>;
}

export type {
    ResolverClient
};
