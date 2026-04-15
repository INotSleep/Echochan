class ServiceRegistry {
    private services: Map<string, any>;

    constructor() {
        this.services = new Map();
    }

    register<T>(name: string, service: T): void {
        if (this.services.has(name)) {
            throw new Error(`Service with name "${name}" is already registered.`);
        }
        this.services.set(name, service);
    }

    get<T>(name: string): T {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service with name "${name}" is not registered.`);
        }
        return service as T;
    }
}

export {
    ServiceRegistry
};