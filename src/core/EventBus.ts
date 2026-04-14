type EventMap = Record<string, unknown>;

type EventKeysWithPayload<TEvents extends EventMap> = {
    [K in keyof TEvents]: TEvents[K] extends undefined ? never : K
}[keyof TEvents];

type EventKeysWithoutPayload<TEvents extends EventMap> = {
    [K in keyof TEvents]: TEvents[K] extends undefined ? K : never
}[keyof TEvents];

type EventHandler<T> = T extends undefined
    ? () => void | Promise<void>
    : (payload: T) => void | Promise<void>;

export class EventBus<TEvents extends EventMap> {
    private readonly handlers = new Map<keyof TEvents, Set<EventHandler<any>>>();

    public on<TKey extends keyof TEvents>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): () => void {
        let set = this.handlers.get(event);

        if (!set) {
            set = new Set<EventHandler<TEvents[TKey]>>();
            this.handlers.set(event, set);
        }

        set.add(handler);

        return () => {
            this.off(event, handler);
        };
    }

    public once<TKey extends keyof TEvents>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): () => void {
        let isActive = true;

        const wrapped = (async (...args: [TEvents[TKey]] | []) => {
            if (!isActive) {
                return;
            }

            isActive = false;
            this.off(event, wrapped as EventHandler<TEvents[TKey]>);

            if (args.length === 0) {
                await (handler as () => void | Promise<void>)();
                return;
            }

            await (handler as (payload: TEvents[TKey]) => void | Promise<void>)(args[0]);
        }) as EventHandler<TEvents[TKey]>;

        return this.on(event, wrapped);
    }

    public off<TKey extends keyof TEvents>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): void {
        const set = this.handlers.get(event);

        if (!set) {
            return;
        }

        set.delete(handler);

        if (set.size === 0) {
            this.handlers.delete(event);
        }
    }

    public listenerCount<TKey extends keyof TEvents>(event: TKey): number {
        return this.handlers.get(event)?.size ?? 0;
    }

    public removeAllListeners<TKey extends keyof TEvents>(event?: TKey): void {
        if (event === undefined) {
            this.handlers.clear();
            return;
        }

        this.handlers.delete(event);
    }

    public async emit<TKey extends EventKeysWithoutPayload<TEvents>>(event: TKey): Promise<void>;
    public async emit<TKey extends EventKeysWithPayload<TEvents>>(
        event: TKey,
        payload: TEvents[TKey]
    ): Promise<void>;
    public async emit<TKey extends keyof TEvents>(
        event: TKey,
        payload?: TEvents[TKey]
    ): Promise<void> {
        const set = this.handlers.get(event);

        if (!set || set.size === 0) {
            return;
        }

        const handlers = [...set];

        for (const handler of handlers) {
            if (payload === undefined) {
                await (handler as () => void | Promise<void>)();
                continue;
            }

            await (handler as (payload: TEvents[TKey]) => void | Promise<void>)(payload);
        }
    }

    public async emitParallel<TKey extends EventKeysWithoutPayload<TEvents>>(event: TKey): Promise<void>;
    public async emitParallel<TKey extends EventKeysWithPayload<TEvents>>(
        event: TKey,
        payload: TEvents[TKey]
    ): Promise<void>;
    public async emitParallel<TKey extends keyof TEvents>(
        event: TKey,
        payload?: TEvents[TKey]
    ): Promise<void> {
        const set = this.handlers.get(event);

        if (!set || set.size === 0) {
            return;
        }

        const handlers = [...set];

        await Promise.all(
            handlers.map((handler) => {
                if (payload === undefined) {
                    return (handler as () => void | Promise<void>)();
                }

                return (handler as (payload: TEvents[TKey]) => void | Promise<void>)(payload);
            })
        );
    }

    public hasListeners<TKey extends keyof TEvents>(event: TKey): boolean {
        return this.listenerCount(event) > 0;
    }
}