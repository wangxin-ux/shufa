import { ParentCampusLocation } from '../types/parent';

export interface ParentCampusMarker {
  id: number;
  campusId: string;
  latitude: number;
  longitude: number;
  iconPath: string;
  width: number;
  height: number;
  callout: {
    content: string;
    display: 'ALWAYS' | 'BYCLICK';
    padding: number;
    borderRadius: number;
    color: string;
    bgColor: string;
  };
}

export function formatCampusDistance(distanceMeters: number | null): string {
  if (distanceMeters === null) return '距离未知';
  if (distanceMeters < 1000) return `约 ${distanceMeters} 米`;
  return `约 ${(distanceMeters / 1000).toFixed(1)} 公里`;
}

export function buildCampusMarkers(
  campuses: ParentCampusLocation[],
  selectedCampusId: string | null,
): ParentCampusMarker[] {
  return campuses.map((campus, index) => ({
    id: index + 1,
    campusId: campus.id,
    latitude: campus.latitude,
    longitude: campus.longitude,
    iconPath: '/pages/parent/assets/map-marker.png',
    width: 28,
    height: 34,
    callout: {
      content: campus.name,
      display: campus.id === selectedCampusId ? 'ALWAYS' : 'BYCLICK',
      padding: 6,
      borderRadius: 6,
      color: '#171717',
      bgColor: '#fffaf0',
    },
  }));
}
