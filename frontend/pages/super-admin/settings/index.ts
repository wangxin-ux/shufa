import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminSystemSettings } from '../../../types/super-admin';

Page({ data: { viewState: 'loading', errorMessage: '', settings: null as SuperAdminSystemSettings | null }, onLoad() { void this.load(); }, async load() { const state = await superAdminService.loadSystemSettings(); if (state.status === 'success') this.setData({ viewState: 'ready', settings: state.data }); else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message }); }, onRetry() { void this.load(); } });
