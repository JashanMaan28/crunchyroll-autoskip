import './common'
import '../demo/shim'
import '../ext/defaults.js'
import '../ext/planner.js'
import '../ext/overlay.js'
import { createRoot } from 'react-dom/client'
import Demo from '../demo/Demo'

const mount = document.getElementById('demo')
if (mount) createRoot(mount).render(<Demo />)
