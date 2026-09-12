import * as fs from "fs";
import * as path from "path";
import {
  buildCampusManagerProfilePageModel,
  CAMPUS_MANAGER_PROFILE_ACTIONS,
  resolveCampusManagerProfileAction,
} from "../services/campus-manager-profile.presenter";

describe("campus manager profile", () => {
  it("builds administrator identity from API data", () => {
    expect(
      buildCampusManagerProfilePageModel({
        displayName: "周园长名字很长也要正常换行",
        roleCode: "CAMPUS_MANAGER",
        campusId: "campus-east",
        campusName: "启明青少年成长中心旗舰校区",
      }),
    ).toEqual({
      displayName: "周园长名字很长也要正常换行",
      identityLabel: "分校区管理员",
      campusName: "启明青少年成长中心旗舰校区",
    });
  });

  it("exposes every confirmed business entry without finance commands", () => {
    expect(CAMPUS_MANAGER_PROFILE_ACTIONS).toEqual([
      { key: "students", label: "人员管理" },
      { key: "schedule", label: "排课管理" },
      { key: "approvals", label: "请假审批" },
      { key: "warnings", label: "预警名单" },
      { key: "settings", label: "校区设置" },
    ]);
    expect(resolveCampusManagerProfileAction("warnings")).toEqual({
      kind: "navigate",
      url: "/pages/campus-manager/warnings/index",
    });
    expect(JSON.stringify(CAMPUS_MANAGER_PROFILE_ACTIONS)).not.toMatch(
      /新增|收益|提现|分成|财务|课时调整/,
    );
  });

  it("uses complete PSD character assets and only the shared logout control", () => {
    const root = path.resolve(__dirname, "..");
    const pageDir = path.join(root, "pages/campus-manager/profile");
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const app = JSON.parse(
      fs.readFileSync(path.join(root, "app.json"), "utf8"),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const assetDir = path.join(root, "pages/campus-manager/assets");

    expect(
      fs.existsSync(path.join(assetDir, "profile-top-character.png")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(assetDir, "profile-lower-character.png")),
    ).toBe(true);
    expect(markup).toContain(
      "/pages/campus-manager/assets/profile-top-character.png",
    );
    expect(markup).toContain(
      "/pages/campus-manager/assets/profile-lower-character.png",
    );
    expect(logic).not.toContain("sessionService.canSwitchTestAccount()");
    expect(logic).not.toContain("sessionService.prepareTestAccountSwitch()");
    expect(markup).toContain("<session-logout");
    expect(`${markup}\n${logic}`).not.toMatch(
      /切换(?:本地)?测试账号|切换使用身份/,
    );
    expect(markup).toContain('surfacePage="{{true}}"');
    expect(markup).toContain('plainMark="{{true}}"');
    expect(markup).toContain(
      "/pages/campus-manager/assets/profile-mark-glyph.png",
    );
    expect(styles).toMatch(/pointer-events:\s*none/);
    expect(styles).toMatch(/max-width:\s*100%/);
    expect(
      app.subPackages.find((item) => item.root === "pages/campus-manager")
        ?.pages,
    ).toContain("profile/index");
    expect(`${markup}\n${logic}`).not.toMatch(
      /凯曼|教育赋能|Kaiman|Education Empowerment/i,
    );
  });

  it("uses the teacher profile geometry for cards, controls, fonts, and artwork", () => {
    const root = path.resolve(__dirname, "..");
    const markup = fs.readFileSync(
      path.join(root, "pages/campus-manager/profile/index.wxml"),
      "utf8",
    );
    const styles = fs.readFileSync(
      path.join(root, "pages/campus-manager/profile/index.wxss"),
      "utf8",
    );
    const shellMarkup = fs.readFileSync(
      path.join(
        root,
        "components/campus-manager-page-shell/campus-manager-page-shell.wxml",
      ),
      "utf8",
    );

    expect(shellMarkup).toContain("shell__header-inner--surface");
    expect(markup).toContain('class="profile-card__meta"');
    expect(markup).toContain('<view class="profile-action__bullet"');
    expect(styles).toMatch(/\.profile\s*\{[^}]*padding:\s*84rpx/s);
    expect(styles).toMatch(/\.profile\s*\{[^}]*overflow:\s*visible/s);
    expect(styles).toMatch(
      /\.profile::after\s*\{[^}]*top:\s*calc\(100vh - 270rpx\)[^}]*bottom:\s*auto/s,
    );
    expect(styles).toMatch(/\.profile-hero\s*\{[^}]*height:\s*456rpx/s);
    expect(styles).toMatch(
      /\.profile-card\s*\{[^}]*left:\s*14rpx[^}]*width:\s*653rpx[^}]*min-height:\s*265rpx[^}]*border-radius:\s*32rpx/s,
    );
    expect(styles).toMatch(/\.profile-card__name\s*\{[^}]*font-size:\s*78rpx/s);
    expect(styles).toMatch(
      /\.profile-hero__character\s*\{[^}]*right:\s*-32rpx[^}]*width:\s*462rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-actions-stage__character\s*\{[^}]*top:\s*100rpx[^}]*left:\s*-32rpx[^}]*width:\s*573rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-actions\s*\{[^}]*width:\s*653rpx[^}]*margin-left:\s*14rpx[^}]*border-radius:\s*32rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-action\s*\{[^}]*display:\s*flex[^}]*min-height:\s*88rpx[^}]*padding:\s*18rpx 22rpx/s,
    );
    expect(styles).toMatch(/\.profile-action\s*\{[^}]*line-height:\s*1\.2/s);
    expect(styles).toMatch(
      /\.profile-action__label\s*\{[^}]*font-size:\s*34rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-action__command\s*\{[^}]*min-width:\s*104rpx[^}]*min-height:\s*56rpx[^}]*border-radius:\s*16rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-card__meta\s*\{[^}]*flex-direction:\s*row[^}]*align-items:\s*baseline/s,
    );
    expect(styles).toMatch(
      /\.profile-card__meta\s*\{[^}]*width:\s*360rpx[^}]*max-width:\s*360rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-card__name,[\s\S]*\.profile-card__role\s*\{[^}]*z-index:\s*3/s,
    );
    expect(styles).toMatch(/\.profile-hero__character\s*\{[^}]*z-index:\s*2/s);
    expect(styles).toMatch(
      /\.profile-actions-stage\s*\{[^}]*min-height:\s*850rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-session\s*\{[^}]*margin:\s*28rpx 0 120rpx 14rpx/s,
    );
  });
});
