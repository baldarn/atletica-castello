FTP_USERNAME ?= $(shell echo $$FTP_USERNAME)
FTP_PASSWORD ?= $(shell echo $$FTP_PASSWORD)
FTP_SERVER ?= $(shell echo $$FTP_SERVER)
FTP_REMOTE_DIR ?= $(shell echo $$FTP_REMOTE_DIR)

deploy:
	rm -rf public
	hugo

	lftp -e "\
	set ftp:ssl-allow no; \
	open -u $(FTP_USERNAME),$(FTP_PASSWORD) $(FTP_SERVER); \
	mirror --reverse --continue --verbose public $(FTP_REMOTE_DIR); \
	bye"

dev:
	hugo server -D
