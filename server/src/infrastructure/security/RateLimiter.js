export class RateLimiter {
    #hits = new Map();
    #maxRequests;
    #windowMs;

    constructor(maxRequests = 60, windowMs = 60_000) {
        this.#maxRequests = maxRequests;
        this.#windowMs = windowMs;
    }

    isAllowed(clientKey) {
        const now = Date.now();
        const record = this.#hits.get(clientKey);

        if (!record || now > record.resetAt) {
            this.#hits.set(clientKey, { count: 1, resetAt: now + this.#windowMs });
            return true;
        }

        if (record.count >= this.#maxRequests) {
            return false;
        }

        record.count += 1;
        return true;
    }
}