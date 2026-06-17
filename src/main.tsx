import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

// Dev-only: expose dataset + helpers for live sanity checks via preview_eval.
if (import.meta.env.DEV) {
  void import('./lib/debug')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
)
