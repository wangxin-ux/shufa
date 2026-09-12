import {
  buildCampusMarkers,
  formatCampusDistance,
} from '../services/parent-campus.presenter';
import { ParentCampusLocation } from '../types/parent';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

const campuses: ParentCampusLocation[] = [
  {
    id: 'campus-east',
    name: '启明东校区',
    address: '长沙市岳麓区启明路 18 号',
    contactPhone: '0731-88886666',
    latitude: 28.2282,
    longitude: 112.9388,
    distanceMeters: 860,
  },
  {
    id: 'campus-west',
    name: '启明西校区',
    address: '长沙市岳麓区枫林路 66 号',
    contactPhone: null,
    latitude: 28.2053,
    longitude: 112.8891,
    distanceMeters: 1240,
  },
];

describe('parent campus map presenter', () => {
  it('registers location privacy and native map interactions', () => {
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as {
      pages: string[];
      subPackages: Array<{ root: string; pages: string[] }>;
      permission?: Record<string, { desc: string }>;
      requiredPrivateInfos?: string[];
    };
    const parentPages =
      app.subPackages.find(({ root: packageRoot }) => packageRoot === 'pages/parent')
        ?.pages ?? [];
    expect(app.pages).toEqual(['pages/bootstrap/index']);
    expect(parentPages).toContain('campuses/index');
    expect(app.permission?.['scope.userLocation']?.desc).toContain('附近门店');
    expect(app.requiredPrivateInfos).toEqual(
      expect.arrayContaining(['getLocation', 'chooseLocation']),
    );

    const markup = fs.readFileSync(
      path.join(root, 'pages/parent/campuses/index.wxml'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(root, 'pages/parent/campuses/index.ts'),
      'utf8',
    );
    expect(markup).toContain('<map');
    expect(markup).toContain('show-location');
    expect(markup).toContain('bindmarkertap');
    expect(markup).toContain('导航前往');
    expect(markup).toContain('重新定位');
    expect(script).toContain('wx.getLocation');
    expect(script).toContain('wx.openLocation');
    expect(script).toContain('wx.makePhoneCall');
  });

  it('formats short, long and unknown distances in Chinese', () => {
    expect(formatCampusDistance(860)).toBe('约 860 米');
    expect(formatCampusDistance(1240)).toBe('约 1.2 公里');
    expect(formatCampusDistance(null)).toBe('距离未知');
  });

  it('builds stable numeric map markers and marks the selected campus', () => {
    expect(buildCampusMarkers(campuses, 'campus-east')[0]).toMatchObject({
      id: 1,
      latitude: 28.2282,
      longitude: 112.9388,
      width: 28,
      height: 34,
    });
    expect(buildCampusMarkers(campuses, 'campus-east')[0].callout).toMatchObject({
      content: '启明东校区',
      display: 'ALWAYS',
    });
  });
});
