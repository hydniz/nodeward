import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>
        <App />
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
