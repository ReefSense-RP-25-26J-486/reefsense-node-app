const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const { requestLogger } = require('./src/middleware/requestLogger');
const { errorHandler }  = require('./src/middleware/errorHandler');
const mountRoutes       = require('./src/routes');

const app = express();

// Global Middleware

const allowedOrigins = [
  'https://reefsense-web-app.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
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
