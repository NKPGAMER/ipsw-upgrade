# Tái cấu trúc code

## Downloader Config
Bây giờ khi khởi tạo sẽ nhận:
- maxConnections:       Tổng số kết nối mạng toàn cục              (Mặc định: 0 (unlimited))
- maxSsdTasks:          Số task SSD đồng thời tối đa               (Mặc định: 3)
- maxHddTasks:          Số task HDD đồng thời tối đa               (Mặc định: 1)
- maxExternalSsdTasks:  Số task ổ SSD ngoài đồng thời tối đa       (Mặc định: 2)
- maxUsbTasks: 	      Số task USB đồng thời tối đa               (Mặc định: 1)
- maxTransfers:         Số transfer đồng thời tối đa               (Mặc định: 1)
- performance:          Chế độ tải (Thay thế cho turbo)            (Mặc định: 0 (0: "normal", 1: "high"))
- saveDir:              Đường dẫn để lưu tệp tải về                (Yêu cầu)
- stateDir:             Đường dẫn để lưu các state                 (Yêu cầu)
- useTmp:               Có sử dụng SSD làm TMP nếu saveDir là HDD  (Mặc định: false)
- maxTaskConnections:   Connection HTTP tối đa của Task            (Mặc định: 116)
- TaskIniConnection:    Connection khởi đầu                        (Mặc định: 4)
- autoResume:           Tự động tải tiếp task còn dở khi restart   (Mặc định: false)
- retryLimit:           Số lần retry của từng chunk                (Mặc định: 3)
- retryDelay:           Delay giữa các lần retry                   (Mặc định: 2000)
- bandwidthLimit:       Giới hạn băng thông                        (Mặc định: 0 (unlimited))

## Task Config
Giờ sẽ có:
- shaAlgorithm: Thuật toán hash để verify - Mặc định: undefined ("md5" | "sha1" | "sha256"). Bỏ qua, không stream Hash nếu không thiết lập
- taskId: Dùng để tải tiếp task còn dở

## Performance
> Loại bỏ hoàn toàn turbo, luồng turbo, ...
> Thay vào đó performance.high sẽ tăng tốc, mở hết công suất và chia đều cho tất cả task
> Bây giờ không cần biết task normal hay turbo, chỉ biết mode tải xuống là normal hay high

## Stream Hash
- Đổi luồng từ `download -> hash -> move` thành `download chunk -> write chunk -> push hash queue`
- Vì tải nhiều luồng nên sẽ hash theo offset chunk:
  - Mỗi chunk tải xong -> write -> push
  - Hash queue sẽ chờ chunk kế tiếp xong thì hash

## Copy/Move/Hash files
- Không xử dụng fs của node để move, copy. Thay vào đó. Gọi method từ rust để move, copy.
- Khi hash full file, không tự hash. Thay vào đó, gọi xuống rust để hash

## Remove Dead Code
- resumeIncomplete
- updateChunk
- setMovedChunks
- getIncompleteChunks
- getTotalReserved