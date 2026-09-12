import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminRolePermission } from '../../../types/super-admin';
import { permissionLabel } from '../../../utils/super-admin-format';

Page({
  data: { viewState: 'loading', errorMessage: '', roles: [] as Array<SuperAdminRolePermission & { permissionLabels: string[] }> },
  onLoad() { void this.load(); },
  async load() { const state = await superAdminService.loadRolePermissions(); if (state.status === 'success' || state.status === 'empty') this.setData({ viewState: state.status, roles: state.data.map((role) => ({ ...role, permissionLabels: role.permissions.map(permissionLabel) })) }); else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message }); },
  onRetry() { void this.load(); },
});
