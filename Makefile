deploy:
	rm -rf public
	hugo
	ssh baldarn@cervellone.lan "rm -rf sites/atletica-castello; exit;"
	scp -r public baldarn@cervellone.lan:~/sites/atletica-castello

dev:
	hugo server -D
