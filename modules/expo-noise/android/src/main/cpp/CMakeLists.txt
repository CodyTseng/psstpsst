cmake_minimum_required(VERSION 3.22)

project(expo_noise LANGUAGES C)

add_subdirectory(../../../../common psst-noise-core)

add_library(expo-noise SHARED noise_jni.c)
target_compile_features(expo-noise PRIVATE c_std_11)
target_link_options(expo-noise PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384"
)
target_link_libraries(expo-noise PRIVATE psst-noise-core log)
