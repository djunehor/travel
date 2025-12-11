/**
 * Task Queue Manager with Redis Persistence
 * Implements a FIFO queue to manage concurrent task processing
 * Limits concurrent tasks to MAX_CONCURRENT tasks due to browser automation RAM requirements
 * Persists queue state to Redis for durability across server restarts
 */

import { getRedisClient } from './redis.js';

const MAX_CONCURRENT = 2;
const QUEUE_KEY = 'task:queue:pending';
const ACTIVE_KEY = 'task:queue:active';
const QUEUE_LOCK_KEY = 'task:queue:lock';

let activeTaskCount = 0;
const taskQueue = [];
let processingCallbacks = new Map(); // taskId -> { process, timeoutId }
let isProcessing = false;

export async function initializeQueue() {
    activeTaskCount = 0;
    taskQueue.length = 0;
    processingCallbacks.clear();
    isProcessing = false;

    const redis = getRedisClient();
    if (!redis) {
        console.warn('⚠️ Redis not available, queue will not persist');
        return;
    }

    try {
        // Load active tasks from Redis on startup
        const activeKeys = await redis.smembers(ACTIVE_KEY);
        activeTaskCount = activeKeys.length;
        console.log(new Date().toLocaleString(), `[QUEUE] Loaded ${activeTaskCount} active tasks from Redis`);

        // Load pending queue from Redis
        const queueLength = await redis.llen(QUEUE_KEY);
        console.log(new Date().toLocaleString(), `[QUEUE] Loaded ${queueLength} pending tasks from Redis`);
    } catch (err) {
        console.warn('⚠️ Failed to load queue from Redis:', err.message);
    }
}

/**
 * Enqueue a task for processing
 * @param {string} taskId - The task ID
 * @param {Function} processFunc - Async function that processes the task
 * @returns {Object} Queue position info
 */
export async function enqueueTask(taskId, processFunc) {
    const redis = getRedisClient();

    // Add to in-memory structures
    const position = taskQueue.length + 1;
    const queueInfo = {
        taskId,
        position,
        totalQueued: taskQueue.length + activeTaskCount
    };

    taskQueue.push({ taskId, processFunc });
    processingCallbacks.set(taskId, { process: processFunc, timeoutId: null });

    // Persist to Redis
    if (redis) {
        try {
            await redis.rpush(QUEUE_KEY, taskId);
        } catch (err) {
            console.warn('⚠️ Failed to persist task to Redis queue:', err.message);
        }
    }

    processNextTask();
    return queueInfo;
}

/**
 * Process the next task in the queue if slots are available
 */
export async function processNextTask() {
    if (isProcessing || activeTaskCount >= MAX_CONCURRENT || taskQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const redis = getRedisClient();

    try {
        activeTaskCount++;
        const { taskId, processFunc } = taskQueue.shift();

        // Move task from pending queue to active set in Redis
        if (redis) {
            try {
                await redis.lrem(QUEUE_KEY, 0, taskId);
                await redis.sadd(ACTIVE_KEY, taskId);
            } catch (err) {
                console.warn('⚠️ Failed to update Redis queue state:', err.message);
            }
        }

        console.log(new Date().toLocaleString(), `[QUEUE] Starting task ${taskId} (Active: ${activeTaskCount}/${MAX_CONCURRENT}, Pending: ${taskQueue.length})`);

        try {
            await processFunc();
            console.log(new Date().toLocaleString(), `[QUEUE] Completed task ${taskId}`);
        } catch (err) {
            console.error(new Date().toLocaleString(), `[QUEUE] Error processing task ${taskId}:`, err.message);
        } finally {
            // Remove from active set
            if (redis) {
                try {
                    await redis.srem(ACTIVE_KEY, taskId);
                } catch (err) {
                    console.warn('⚠️ Failed to remove task from active set:', err.message);
                }
            }

            activeTaskCount--;
            processingCallbacks.delete(taskId);
        }
    } finally {
        isProcessing = false;
        // Process next task if available
        processNextTask();
    }
}

/**
 * Get queue status
 * @returns {Object} Queue status info
 */
export async function getQueueStatus() {
    const redis = getRedisClient();
    let redisQueuedCount = 0;
    let redisActiveCount = 0;

    if (redis) {
        try {
            redisQueuedCount = await redis.llen(QUEUE_KEY);
            redisActiveCount = await redis.scard(ACTIVE_KEY);
        } catch (err) {
            console.warn('⚠️ Failed to get queue status from Redis:', err.message);
        }
    }

    return {
        activeCount: Math.max(activeTaskCount, redisActiveCount),
        maxConcurrent: MAX_CONCURRENT,
        queuedCount: Math.max(taskQueue.length, redisQueuedCount),
        totalPending: Math.max(activeTaskCount + taskQueue.length, redisActiveCount + redisQueuedCount),
        queuedTasks: taskQueue.map((item, idx) => ({
            taskId: item.taskId,
            position: idx + 1
        }))
    };
}

/**
 * Get a specific task's queue position
 * @param {string} taskId - The task ID
 * @returns {Object|null} Queue position info or null if not queued/active
 */
export async function getTaskQueuePosition(taskId) {
    const queueIndex = taskQueue.findIndex(item => item.taskId === taskId);
    if (queueIndex !== -1) {
        return {
            isQueued: true,
            isActive: false,
            position: queueIndex + 1,
            totalQueued: taskQueue.length
        };
    }

    if (processingCallbacks.has(taskId)) {
        return {
            isQueued: false,
            isActive: true,
            position: null,
            totalQueued: taskQueue.length
        };
    }

    // Check Redis for task that might be persisted
    const redis = getRedisClient();
    if (redis) {
        try {
            const inQueue = await redis.lpos(QUEUE_KEY, taskId);
            if (inQueue !== null) {
                return {
                    isQueued: true,
                    isActive: false,
                    position: inQueue + 1,
                    totalQueued: await redis.llen(QUEUE_KEY)
                };
            }

            const inActive = await redis.sismember(ACTIVE_KEY, taskId);
            if (inActive) {
                return {
                    isQueued: false,
                    isActive: true,
                    position: null,
                    totalQueued: await redis.llen(QUEUE_KEY)
                };
            }
        } catch (err) {
            console.warn('⚠️ Failed to check Redis for task position:', err.message);
        }
    }

    return null;
}

/**
 * Remove a task from queue
 * @param {string} taskId - The task ID
 * @returns {boolean} True if task was removed
 */
export async function removeTaskFromQueue(taskId) {
    const index = taskQueue.findIndex(item => item.taskId === taskId);
    let removed = false;

    if (index !== -1) {
        taskQueue.splice(index, 1);
        processingCallbacks.delete(taskId);
        removed = true;
    }

    // Also remove from Redis if present
    const redis = getRedisClient();
    if (redis) {
        try {
            const redisRemoved = await redis.lrem(QUEUE_KEY, 0, taskId);
            if (redisRemoved > 0) removed = true;
        } catch (err) {
            console.warn('⚠️ Failed to remove task from Redis queue:', err.message);
        }
    }

    return removed;
}
