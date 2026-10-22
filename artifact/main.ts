import { start } from '@/components/atlas-engine';
import { shellHTML } from '@/components/shell';
import { createClaudeApi } from './claude-api';

function mount() {
  const root = document.createElement('div');
  root.className = 'app';
  root.innerHTML = shellHTML(document.title || 'Sparkles');
  document.body.prepend(root);
  createClaudeApi().then(({ api, viewer }) => start(viewer as any, api as any));
}
if (document.body) mount();
else addEventListener('DOMContentLoaded', mount);
