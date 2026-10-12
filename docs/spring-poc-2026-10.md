# Spring Boot 이전 실험 (2026-10-12)

학습 목적으로 이 서버의 핵심 경로를 Spring Boot 4.1 + Java 25로 옮기고, 같은 Raspberry Pi 4에서
프로덕션 Go 이미지(`sha-d04d885`)와 똑같은 부하로 비교했습니다. **이전 계획은 없습니다.**
코드, 측정 도구, 전체 리포트는 별도 저장소에 있습니다:
[FelisCatusKR/chzzk-djclass-spring-poc](https://github.com/FelisCatusKR/chzzk-djclass-spring-poc)
([REPORT.md](https://github.com/FelisCatusKR/chzzk-djclass-spring-poc/blob/main/REPORT.md)).

부하: SSE 100개(20채널 × 5), 초당 채팅 100개, 90초.

| 변형                                 |     이미지 |      기동 | 유휴 RSS | 부하 중 최대 RSS |   CPU 시간 |
| ------------------------------------ | ---------: | --------: | -------: | ---------------: | ---------: |
| **Go (프로덕션)**                    | **17.9MB** | **1.1초** | **15MB** |         **35MB** | **15.6초** |
| Spring, 기본 JRE                     |      423MB |    23.8초 |    216MB |            273MB |     69.8초 |
| Spring, jlink + AOT 캐시 + JVM 튜닝  |      221MB |     9.0초 |    176MB |            212MB |     67.5초 |
| Spring, GraalVM 네이티브 + `-Xmx64m` |      155MB |     1.8초 |    109MB |            137MB |     26.5초 |

## 이 저장소에 주는 시사점

- 이 호스트와 "머지마다 재시작" 배포 방식에서는 Go가 메모리·이미지·기동 시간 모두 크게 유리합니다.
  JVM은 기동하는 동안(9~26초) 위젯이 끊깁니다.
- 동시성 구조(요청당 블로킹 SSE 루프, 채널당 ingest/flush 워커)는 Java 21+ 가상 스레드로 거의 그대로 옮겨집니다.
  언어를 바꿔야 할 구조적인 이유는 없었습니다.
- GraalVM 네이티브에서 Jackson record 리플렉션 누락이 `Error`로 터져 flush 스레드가 죽고 채널이 조용히
  멈춘 사례가 있었습니다. Go `realtime`에도 같은 질문이 유효합니다: 배치 하나의 실패가 채널 전체를
  멈추지 않는가? 현재 `flushOnce`는 인코딩 오류를 로그로 남기고 넘어가며, resolver 오류는 `unlinked`로
  강등합니다.
