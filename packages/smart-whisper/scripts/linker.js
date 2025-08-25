"use strict";

var libs = [];
if (process.env.WHISPER_OPENBLAS) {
	libs.push(`-lopenblas`);
}
if (process.env.WHISPER_CUBLAS) {
	libs.push(
		`-lcuda -lcublas -lculibos -lcudart -lcublasLt -lpthread -ldl -lrt -L/usr/local/cuda/lib64 -L/opt/cuda/lib64`,
	);
}
if (process.env.WHISPER_HIPBLAS) {
	libs.push(
		`lhipblas -lamdhip64 -lrocblas -L/opt/rocm/lib -L/opt/rocm/hipblas/lib -Wl,-rpath=/opt/rocm/lib`,
	);
}
if (process.env.WHISPER_CLBLAST) {
	libs.push(`-lclblast -lOpenCL`);
}

console.log(libs.join(" "));
