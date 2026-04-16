type EventMap = object;

type EventKey<TEvents extends EventMap> = Extract<keyof TEvents, string>;

type EventArgs<T> = [T] extends [undefined] ? [] : [payload: T];

type EventHandler<T> = (...args: EventArgs<T>) => void | Promise<void>;

export class EventBus<TEvents extends EventMap> {
    private readonly handlers = new Map<EventKey<TEvents>, Set<(...args: unknown[]) => void | Promise<void>>>();

    public on<TKey extends EventKey<TEvents>>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): () => void {
        let set = this.handlers.get(event);

        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }

        set.add(handler as (...args: unknown[]) => void | Promise<void>);

        return () => {
            this.off(event, handler);
        };
    }

    public once<TKey extends EventKey<TEvents>>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): () => void {
        let isActive = true;

        const wrapped: EventHandler<TEvents[TKey]> = async (...args) => {
            if (!isActive) {
                return;
            }

            isActive = false;
            this.off(event, wrapped);
            await handler(...args);
        };

        return this.on(event, wrapped);
    }

    public off<TKey extends EventKey<TEvents>>(
        event: TKey,
        handler: EventHandler<TEvents[TKey]>
    ): void {
        const set = this.handlers.get(event);

        if (!set) {
            return;
        }

        set.delete(handler as (...args: unknown[]) => void | Promise<void>);

        if (set.size === 0) {
            this.handlers.delete(event);
        }
    }

    public listenerCount<TKey extends EventKey<TEvents>>(event: TKey): number {
        return this.handlers.get(event)?.size ?? 0;
    }

    public removeAllListeners<TKey extends EventKey<TEvents>>(event?: TKey): void {
        if (event === undefined) {
            this.handlers.clear();
            return;
        }

        this.handlers.delete(event);
    }

    public async emit<TKey extends EventKey<TEvents>>(
        event: TKey,
        ...args: EventArgs<TEvents[TKey]>
    ): Promise<void> {
        const set = this.handlers.get(event);

        if (!set || set.size === 0) {
            return;
        }

        const handlers = [...set] as Array<EventHandler<TEvents[TKey]>>;

        for (const handler of handlers) {
            await handler(...args);
        }
    }

    public async emitParallel<TKey extends EventKey<TEvents>>(
        event: TKey,
        ...args: EventArgs<TEvents[TKey]>
    ): Promise<void> {
        const set = this.handlers.get(event);

        if (!set || set.size === 0) {
            return;
        }

        const handlers = [...set] as Array<EventHandler<TEvents[TKey]>>;

        await Promise.all(handlers.map((handler) => handler(...args)));
    }

    public hasListeners<TKey extends EventKey<TEvents>>(event: TKey): boolean {
        return this.listenerCount(event) > 0;
    }
}
