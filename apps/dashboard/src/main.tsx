import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { GatewayConnectionProvider } from './api/gateway-connection.js';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GatewayConnectionProvider port={3001}>
      <App />
    </GatewayConnectionProvider>
  </React.StrictMode>,
);
