import './common'
import '../styles/home.css'
import { createRoot } from 'react-dom/client'
import HeroDemo from '../hero/HeroDemo'

const mount = document.getElementById('hero-demo')
if (mount) createRoot(mount).render(<HeroDemo />)
