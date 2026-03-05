const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const { requestLogger } = require('./src/middleware/requestLogger');
const { errorHandler }  = require('./src/middleware/errorHandler');
const mountRoutes       = require('./src/routes');

const app = express();

// Global Middleware

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

// Rate limiter — 100 requests per 15 minutes per IP on all /api/* routes
app.use('/api/', rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            100,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Too many requests. Please try again later.' },
}));

// Routes 

mountRoutes(app);

// Health Check 

app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    components: ['gis', 'data', 'bleaching', 'growth'],
  });
});

// 404 

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler 

app.use(errorHandler);

module.exports = app;
