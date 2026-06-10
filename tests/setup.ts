// Setup environment variables sebelum semua tests
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.STRIPE_MOCK_FAILURE_RATE = '0'
