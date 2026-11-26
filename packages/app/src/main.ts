import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { applyTheme, savedTheme } from './lib/theme';

// Before the first render: no flash of the wrong colors.
applyTheme(savedTheme());

const app = mount(App, { target: document.getElementById('app')! });

export default app;
