import type { ResolveProvider, ResolvedEntry, SourceType } from "../contracts.js";

type ResolveModuleContext = {
    input: string;
    sourceType: SourceType;
    requestId: string | null;
    requestedBy: string | null;
};

interface ResolverMicroModule {
    readonly id: ResolveProvider;
    canResolve(sourceType: SourceType): boolean;
    resolveByInput(context: ResolveModuleContext): Promise<ResolvedEntry[]>;
    search(query: string, context: ResolveModuleContext): Promise<string>;
    downloadByLink(input: string, context: ResolveModuleContext): Promise<string>;
}

export type {
    ResolveModuleContext,
    ResolverMicroModule
};
