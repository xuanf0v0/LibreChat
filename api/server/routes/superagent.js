const express = require('express');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { handlers } = require('~/server/services/SuperAgent');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

router.get('/trinity/health', handlers.trinityHealth);
router.get('/workers', handlers.listWorkers);
router.put('/workers/:agentId', handlers.updateWorker);
router.delete('/workers/:agentId', handlers.deleteWorker);

router.get('/tasks', handlers.listTasks);
router.post('/tasks', handlers.createTask);
router.get('/tasks/:id', handlers.getTask);
router.get('/tasks/:id/events', handlers.streamTaskEvents);
router.post('/tasks/:id/cancel', handlers.cancelTask);

module.exports = router;
