import { start } from '@/components/atlas-engine';
import { createClaudeApi } from './claude-api';

createClaudeApi().then(({ api, viewer }) => start(viewer as any, api as any));
