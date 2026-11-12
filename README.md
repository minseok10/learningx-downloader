# learningx-downloader
경희대학교 eCampus 강의 다운로드용 Chrome extension.

https://chrome.google.com/webstore/detail/khu-learningx-lecture-dow/opgeblamcghbggfoocchhedadcfabhil

해당 extension은 외부 nodejs executable 프로그램이 동작하고 있어야 작동합니다. 아래 repository의 release 탭에서 exe를 내려받아 같이 사용하세요.

[https://github.com/mechaminu/learningx-backend/releases](https://github.com/mechaminu/learningx-backend/releases)

확장 프로그램을 통해 강의동영상 정보를 백그라운드에 실행중인 다운로드 프로그램에 전달하면, 동영상이 exe 파일과 동일 경로에 저장됩니다.
무분별한 다운로드 트래픽 발생으로 eCampus 시스템이 교란되는 것을 방지하기 위해 동영상은 동시에 한개씩 다운로드가 허용됩니다.



## Safari에서 사용하기 (macOS)

Safari 확장은 Xcode 앱으로 감싸야 설치할 수 있어서, Mac에서 직접 빌드해야 합니다.

1. Xcode를 설치합니다 (App Store).
2. 저장소 루트에서 빌드 스크립트를 실행합니다.
   ```bash
   ./scripts/build-safari.sh
   ```
   `dist/safari/LearningX Downloader/` 에 Xcode 프로젝트가 생성됩니다.
3. 생성된 `.xcodeproj` 를 Xcode로 열고 실행(⌘R)합니다.
4. Safari > 설정 > 고급에서 "메뉴 막대에서 개발자용 메뉴 보기"를 켜고, 개발자용 메뉴에서 "서명되지 않은 확장 프로그램 허용"을 체크합니다. (Safari 17 이상은 설정 > 개발자 탭)
5. Safari > 설정 > 확장 프로그램에서 LearningX Downloader를 켜고, `khcanvas.khu.ac.kr`, `commons.khu.ac.kr`, `localhost` 접근을 **항상 허용**으로 설정합니다.

다운로드는 Chrome과 마찬가지로 백엔드 프로그램이 `localhost:52022` 에서 실행 중이어야 합니다.

> Safari에는 `webRequest` API가 없어서, 팝업을 열 때 페이지의 프레임을 직접 스캔해서 강의 영상을 찾습니다. 강의 영상 플레이어가 페이지에 로드된 상태에서 팝업을 열어주세요.
