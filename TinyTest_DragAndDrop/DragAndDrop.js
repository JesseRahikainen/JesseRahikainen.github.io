// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

var Module = Module;






// Redefine these in a --pre-js to override behavior. If you would like to
// remove out() or err() altogether, you can no-op it out to function() {},
// and build with --closure 1 to get Closure optimize out all the uses
// altogether.

function out(text) {
  console.log(text);
}

function err(text) {
  console.error(text);
}

// Override this function in a --pre-js file to get a signal for when
// compilation is ready. In that callback, call the function run() to start
// the program.
function ready() {
    run();
}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)

function ready() {
	try {
		if (typeof ENVIRONMENT_IS_PTHREAD === 'undefined' || !ENVIRONMENT_IS_PTHREAD) run();
	} catch(e) {
		// Suppress the JS throw message that corresponds to Dots unwinding the call stack to run the application. 
		if (e !== 'unwind') throw e;
	}
}

(function(global, module){
    var _allocateArrayOnHeap = function (typedArray) {
        var requiredMemorySize = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        var ptr = _malloc(requiredMemorySize);
        var heapBytes = new Uint8Array(HEAPU8.buffer, ptr, requiredMemorySize);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return heapBytes;
    };
    
    var _allocateStringOnHeap = function (string) {
        var bufferSize = lengthBytesUTF8(string) + 1;
        var ptr = _malloc(bufferSize);
        stringToUTF8(string, ptr, bufferSize);
        return ptr;
    };

    var _freeArrayFromHeap = function (heapBytes) {
        if(typeof heapBytes !== "undefined")
            _free(heapBytes.byteOffset);
    };
    
    var _freeStringFromHeap = function (stringPtr) {
        if(typeof stringPtr !== "undefined")
            _free(stringPtr);
    };

    var _sendMessage = function(message, intArr, floatArr, byteArray) {
        if (!Array.isArray(intArr)) {
            intArr = [];
        }
        if (!Array.isArray(floatArr)) {
            floatArr = [];
        }
        if (!Array.isArray(byteArray)) {
            byteArray = [];
        }
        
        var messageOnHeap, intOnHeap, floatOnHeap, bytesOnHeap;
        try {
            messageOnHeap = _allocateStringOnHeap(message);
            intOnHeap = _allocateArrayOnHeap(new Int32Array(intArr));
            floatOnHeap = _allocateArrayOnHeap(new Float32Array(floatArr));
            bytesOnHeap = _allocateArrayOnHeap(new Uint8Array(byteArray));
            
            _SendMessage(messageOnHeap, intOnHeap.byteOffset, intArr.length, floatOnHeap.byteOffset, floatArr.length, bytesOnHeap.byteOffset, byteArray.length);
        }
        finally {
            _freeStringFromHeap(messageOnHeap);
            _freeArrayFromHeap(intOnHeap);
            _freeArrayFromHeap(floatOnHeap);
            _freeArrayFromHeap(bytesOnHeap);
        }
    };

    global["SendMessage"] = _sendMessage;
    module["SendMessage"] = _sendMessage;
})(this, Module);












/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) throw text;
}

function abort(what) {
  throw what;
}

var tempRet0 = 0;
var setTempRet0 = function(value) {
  tempRet0 = value;
}
var getTempRet0 = function() {
  return tempRet0;
}

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}




// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}








var GLOBAL_BASE = 1024,
    TOTAL_STACK = 5242880,
    TOTAL_MEMORY = 16777216,
    STATIC_BASE = 1024,
    STACK_BASE = 2520016,
    STACKTOP = STACK_BASE,
    STACK_MAX = 7762896
    , DYNAMICTOP_PTR = 2519744
    ;


var wasmMaximumMemory = TOTAL_MEMORY;

var wasmMemory = new WebAssembly.Memory({
  'initial': TOTAL_MEMORY >> 16
  , 'maximum': wasmMaximumMemory >> 16
  });

var buffer = wasmMemory.buffer;




var WASM_PAGE_SIZE = 65536;
assert(STACK_BASE % 16 === 0, 'stack must start aligned to 16 bytes, STACK_BASE==' + STACK_BASE);
assert(TOTAL_MEMORY >= TOTAL_STACK, 'TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');
assert((7762896) % 16 === 0, 'heap must start aligned to 16 bytes, DYNAMIC_BASE==' + 7762896);
assert(TOTAL_MEMORY % WASM_PAGE_SIZE === 0);
assert(buffer.byteLength === TOTAL_MEMORY);

var HEAP8 = new Int8Array(buffer);
var HEAP16 = new Int16Array(buffer);
var HEAP32 = new Int32Array(buffer);
var HEAPU8 = new Uint8Array(buffer);
var HEAPU16 = new Uint16Array(buffer);
var HEAPU32 = new Uint32Array(buffer);
var HEAPF32 = new Float32Array(buffer);
var HEAPF64 = new Float64Array(buffer);



  HEAP32[DYNAMICTOP_PTR>>2] = 7762896;



// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  HEAPU32[(STACK_MAX >> 2)-1] = 0x02135467;
  HEAPU32[(STACK_MAX >> 2)-2] = 0x89BACDFE;
}

function checkStackCookie() {
  if (HEAPU32[(STACK_MAX >> 2)-1] != 0x02135467 || HEAPU32[(STACK_MAX >> 2)-2] != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x' + HEAPU32[(STACK_MAX >> 2)-2].toString(16) + ' ' + HEAPU32[(STACK_MAX >> 2)-1].toString(16));
  }
  // Also test the global address 0 for integrity.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) throw 'Runtime error: The application has corrupted its heap memory area (address zero)!';
}



  HEAP32[0] = 0x63736d65; /* 'emsc' */




// Endianness check (note: assumes compiler arch was little-endian)
HEAP16[1] = 0x6373;
if (HEAPU8[2] !== 0x73 || HEAPU8[3] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';

function abortFnPtrError(ptr, sig) {
	var possibleSig = '';
	for(var x in debug_tables) {
		var tbl = debug_tables[x];
		if (tbl[ptr]) {
			possibleSig += 'as sig "' + x + '" pointing to function ' + tbl[ptr] + ', ';
		}
	}
	abort("Invalid function pointer " + ptr + " called with signature '" + sig + "'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this). This pointer might make sense in another type signature: " + possibleSig);
}

function wrapAssertRuntimeReady(func) {
  var realFunc = asm[func];
  asm[func] = function() {
    assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
    assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
    return realFunc.apply(null, arguments);
  }
}




var runtimeInitialized = false;

// This is always false in minimal_runtime - the runtime does not have a concept of exiting (keeping this variable here for now since it is referenced from generated code)
var runtimeExited = false;

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



var memoryInitializer = null;


// Copyright 2015 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.




// === Body ===

var ASM_CONSTS = [function() { ut._HTML.canvasContext.save(); },
 function($0, $1, $2, $3) { ut._HTML.canvasContext.beginPath(); ut._HTML.canvasContext.rect($0, $1, $2, $3); ut._HTML.canvasContext.clip(); },
 function() { ut._HTML.canvasContext.restore(); },
 function() { if (ut._HTML.canvasMode == 'webgl2') return 2; if (ut._HTML.canvasMode == 'webgl') return 1; return 0; }];

function _emscripten_asm_const_sync_on_main_thread_i(code) {
  return ASM_CONSTS[code]();
}

function _emscripten_asm_const_async_on_main_thread_vdddd(code, a0, a1, a2, a3) {
  return ASM_CONSTS[code](a0, a1, a2, a3);
}

function _emscripten_asm_const_async_on_main_thread_v(code) {
  return ASM_CONSTS[code]();
}




// STATICTOP = STATIC_BASE + 2518992;









/* no memory initializer */
var tempDoublePtr = 2520000
assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  function abortStackOverflow(allocSize) {
      abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
    }

  function warnOnce(text) {
      if (!warnOnce.shown) warnOnce.shown = {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        err(text);
      }
    }

  
  var ___exception_infos={};
  
  var ___exception_caught= [];
  
  function ___exception_addRef(ptr) {
      if (!ptr) return;
      var info = ___exception_infos[ptr];
      info.refcount++;
    }
  
  function ___exception_deAdjust(adjusted) {
      if (!adjusted || ___exception_infos[adjusted]) return adjusted;
      for (var key in ___exception_infos) {
        var ptr = +key; // the iteration key is a string, and if we throw this, it must be an integer as that is what we look for
        var adj = ___exception_infos[ptr].adjusted;
        var len = adj.length;
        for (var i = 0; i < len; i++) {
          if (adj[i] === adjusted) {
            return ptr;
          }
        }
      }
      return adjusted;
    }function ___cxa_begin_catch(ptr) {
      var info = ___exception_infos[ptr];
      if (info && !info.caught) {
        info.caught = true;
        __ZSt18uncaught_exceptionv.uncaught_exception--;
      }
      if (info) info.rethrown = false;
      ___exception_caught.push(ptr);
      ___exception_addRef(___exception_deAdjust(ptr));
      return ptr;
    }

  function ___gxx_personality_v0() {
    }

  
  var SYSCALLS={buffers:[null,[],[]],printChar:function(stream, curr) {
        var buffer = SYSCALLS.buffers[stream];
        assert(buffer);
        if (curr === 0 || curr === 10) {
          (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
          buffer.length = 0;
        } else {
          buffer.push(curr);
        }
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall140(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      // NOTE: offset_high is unused - Emscripten's off_t is 32-bit
      var offset = offset_low;
      FS.llseek(stream, offset, whence);
      HEAP32[((result)>>2)]=stream.position;
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  
  function flush_NO_FILESYSTEM() {
      // flush anything remaining in the buffers during shutdown
      var fflush = Module["_fflush"];
      if (fflush) fflush(0);
      var buffers = SYSCALLS.buffers;
      if (buffers[1].length) SYSCALLS.printChar(1, 10);
      if (buffers[2].length) SYSCALLS.printChar(2, 10);
    }function ___syscall146(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // writev
      // hack to support printf in FILESYSTEM=0
      var stream = SYSCALLS.get(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[(((iov)+(i*8))>>2)];
        var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
        for (var j = 0; j < len; j++) {
          SYSCALLS.printChar(stream, HEAPU8[ptr+j]);
        }
        ret += len;
      }
      return ret;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall4(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // write
      // hack to support printf in FILESYSTEM=0
      var stream = SYSCALLS.get(), buf = SYSCALLS.get(), count = SYSCALLS.get();
      for (var i = 0; i < count; i++) {
        SYSCALLS.printChar(stream, HEAPU8[buf+i]);
      }
      return count;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall6(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function _abort() {
      // In MINIMAL_RUNTIME the module object does not exist, so its behavior to abort is to throw directly.
      throw 'abort';
    }

  function _clock() {
      if (_clock.start === undefined) _clock.start = Date.now();
      return ((Date.now() - _clock.start) * (1000000 / 1000))|0;
    }

  var _emscripten_asm_const_async_on_main_thread=true;

  var _emscripten_asm_const_int_sync_on_main_thread=true;

   

  function _emscripten_is_webgl_context_lost(target) {
      return !GL.contexts[target] || GL.contexts[target].GLctx.isContextLost(); // No context ~> lost context.
    }

  function _emscripten_performance_now() {
      return performance.now();
    }

  function _emscripten_request_animation_frame_loop(cb, userData) {
      function tick(timeStamp) {
        if (dynCall_idi(cb, timeStamp, userData)) {
          requestAnimationFrame(tick);
        }
      }
      return requestAnimationFrame(tick);
    }

  
  var Fetch={xhrs:[],setu64:function(addr, val) {
      HEAPU32[addr >> 2] = val;
      HEAPU32[addr + 4 >> 2] = (val / 4294967296)|0;
    },staticInit:function() {
      var isMainThread = (typeof ENVIRONMENT_IS_FETCH_WORKER === 'undefined');
  
  
    }};
  
  function __emscripten_fetch_xhr(fetch, onsuccess, onerror, onprogress) {
    var url = HEAPU32[fetch + 8 >> 2];
    if (!url) {
      onerror(fetch, 0, 'no url specified!');
      return;
    }
    var url_ = UTF8ToString(url);
  
    var fetch_attr = fetch + 112;
    var requestMethod = UTF8ToString(fetch_attr);
    if (!requestMethod) requestMethod = 'GET';
    var userData = HEAPU32[fetch_attr + 32 >> 2];
    var fetchAttributes = HEAPU32[fetch_attr + 48 >> 2];
    var timeoutMsecs = HEAPU32[fetch_attr + 52 >> 2];
    var withCredentials = !!HEAPU32[fetch_attr + 56 >> 2];
    var destinationPath = HEAPU32[fetch_attr + 60 >> 2];
    var userName = HEAPU32[fetch_attr + 64 >> 2];
    var password = HEAPU32[fetch_attr + 68 >> 2];
    var requestHeaders = HEAPU32[fetch_attr + 72 >> 2];
    var overriddenMimeType = HEAPU32[fetch_attr + 76 >> 2];
    var dataPtr = HEAPU32[fetch_attr + 80 >> 2];
    var dataLength = HEAPU32[fetch_attr + 84 >> 2];
  
    var fetchAttrLoadToMemory = !!(fetchAttributes & 1);
    var fetchAttrStreamData = !!(fetchAttributes & 2);
    var fetchAttrAppend = !!(fetchAttributes & 8);
    var fetchAttrReplace = !!(fetchAttributes & 16);
    var fetchAttrSynchronous = !!(fetchAttributes & 64);
    var fetchAttrWaitable = !!(fetchAttributes & 128);
  
    var userNameStr = userName ? UTF8ToString(userName) : undefined;
    var passwordStr = password ? UTF8ToString(password) : undefined;
    var overriddenMimeTypeStr = overriddenMimeType ? UTF8ToString(overriddenMimeType) : undefined;
  
    var xhr = new XMLHttpRequest();
    xhr.withCredentials = withCredentials;
    xhr.open(requestMethod, url_, !fetchAttrSynchronous, userNameStr, passwordStr);
    if (!fetchAttrSynchronous) xhr.timeout = timeoutMsecs; // XHR timeout field is only accessible in async XHRs, and must be set after .open() but before .send().
    xhr.url_ = url_; // Save the url for debugging purposes (and for comparing to the responseURL that server side advertised)
    xhr.responseType = fetchAttrStreamData ? 'moz-chunked-arraybuffer' : 'arraybuffer';
  
    if (overriddenMimeType) {
      xhr.overrideMimeType(overriddenMimeTypeStr);
    }
    if (requestHeaders) {
      for(;;) {
        var key = HEAPU32[requestHeaders >> 2];
        if (!key) break;
        var value = HEAPU32[requestHeaders + 4 >> 2];
        if (!value) break;
        requestHeaders += 8;
        var keyStr = UTF8ToString(key);
        var valueStr = UTF8ToString(value);
        xhr.setRequestHeader(keyStr, valueStr);
      }
    }
    Fetch.xhrs.push(xhr);
    var id = Fetch.xhrs.length;
    HEAPU32[fetch + 0 >> 2] = id;
    var data = (dataPtr && dataLength) ? HEAPU8.slice(dataPtr, dataPtr + dataLength) : null;
    // TODO: Support specifying custom headers to the request.
  
    xhr.onload = function(e) {
      var len = xhr.response ? xhr.response.byteLength : 0;
      var ptr = 0;
      var ptrLen = 0;
      if (fetchAttrLoadToMemory && !fetchAttrStreamData) {
        ptrLen = len;
        // The data pointer malloc()ed here has the same lifetime as the emscripten_fetch_t structure itself has, and is
        // freed when emscripten_fetch_close() is called.
        ptr = _malloc(ptrLen);
        HEAPU8.set(new Uint8Array(xhr.response), ptr);
      }
      HEAPU32[fetch + 12 >> 2] = ptr;
      Fetch.setu64(fetch + 16, ptrLen);
      Fetch.setu64(fetch + 24, 0);
      if (len) {
        // If the final XHR.onload handler receives the bytedata to compute total length, report that,
        // otherwise don't write anything out here, which will retain the latest byte size reported in
        // the most recent XHR.onprogress handler.
        Fetch.setu64(fetch + 32, len);
      }
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      if (xhr.readyState === 4 && xhr.status === 0) {
        if (len > 0) xhr.status = 200; // If loading files from a source that does not give HTTP status code, assume success if we got data bytes.
        else xhr.status = 404; // Conversely, no data bytes is 404.
      }
      HEAPU16[fetch + 42 >> 1] = xhr.status;
      if (xhr.statusText) stringToUTF8(xhr.statusText, fetch + 44, 64);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onsuccess) onsuccess(fetch, xhr, e);
      } else {
        if (onerror) onerror(fetch, xhr, e);
      }
    }
    xhr.onerror = function(e) {
      var status = xhr.status; // XXX TODO: Overwriting xhr.status doesn't work here, so don't override anywhere else either.
      if (xhr.readyState == 4 && status == 0) status = 404; // If no error recorded, pretend it was 404 Not Found.
      HEAPU32[fetch + 12 >> 2] = 0;
      Fetch.setu64(fetch + 16, 0);
      Fetch.setu64(fetch + 24, 0);
      Fetch.setu64(fetch + 32, 0);
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      HEAPU16[fetch + 42 >> 1] = status;
      if (onerror) onerror(fetch, xhr, e);
    }
    xhr.ontimeout = function(e) {
      if (onerror) onerror(fetch, xhr, e);
    }
    xhr.onprogress = function(e) {
      var ptrLen = (fetchAttrLoadToMemory && fetchAttrStreamData && xhr.response) ? xhr.response.byteLength : 0;
      var ptr = 0;
      if (fetchAttrLoadToMemory && fetchAttrStreamData) {
        // The data pointer malloc()ed here has the same lifetime as the emscripten_fetch_t structure itself has, and is
        // freed when emscripten_fetch_close() is called.
        ptr = _malloc(ptrLen);
        HEAPU8.set(new Uint8Array(xhr.response), ptr);
      }
      HEAPU32[fetch + 12 >> 2] = ptr;
      Fetch.setu64(fetch + 16, ptrLen);
      Fetch.setu64(fetch + 24, e.loaded - ptrLen);
      Fetch.setu64(fetch + 32, e.total);
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      if (xhr.readyState >= 3 && xhr.status === 0 && e.loaded > 0) xhr.status = 200; // If loading files from a source that does not give HTTP status code, assume success if we get data bytes
      HEAPU16[fetch + 42 >> 1] = xhr.status;
      if (xhr.statusText) stringToUTF8(xhr.statusText, fetch + 44, 64);
      if (onprogress) onprogress(fetch, xhr, e);
    }
    try {
      xhr.send(data);
    } catch(e) {
      if (onerror) onerror(fetch, xhr, e);
    }
  }
  
  
  var _fetch_work_queue=2519984;function __emscripten_get_fetch_work_queue() {
      return _fetch_work_queue;
    }function _emscripten_start_fetch(fetch, successcb, errorcb, progresscb) {
    if (typeof Module !== 'undefined') Module['noExitRuntime'] = true; // If we are the main Emscripten runtime, we should not be closing down.
  
    var fetch_attr = fetch + 112;
    var requestMethod = UTF8ToString(fetch_attr);
    var onsuccess = HEAPU32[fetch_attr + 36 >> 2];
    var onerror = HEAPU32[fetch_attr + 40 >> 2];
    var onprogress = HEAPU32[fetch_attr + 44 >> 2];
    var fetchAttributes = HEAPU32[fetch_attr + 48 >> 2];
    var fetchAttrLoadToMemory = !!(fetchAttributes & 1);
    var fetchAttrStreamData = !!(fetchAttributes & 2);
    var fetchAttrAppend = !!(fetchAttributes & 8);
    var fetchAttrReplace = !!(fetchAttributes & 16);
  
    var reportSuccess = function(fetch, xhr, e) {
      if (onsuccess) dynCall_vi(onsuccess, fetch);
      else if (successcb) successcb(fetch);
    };
  
    var reportProgress = function(fetch, xhr, e) {
      if (onprogress) dynCall_vi(onprogress, fetch);
      else if (progresscb) progresscb(fetch);
    };
  
    var reportError = function(fetch, xhr, e) {
      if (onerror) dynCall_vi(onerror, fetch);
      else if (errorcb) errorcb(fetch);
    };
  
    var performUncachedXhr = function(fetch, xhr, e) {
      __emscripten_fetch_xhr(fetch, reportSuccess, reportError, reportProgress);
    };
  
    __emscripten_fetch_xhr(fetch, reportSuccess, reportError, reportProgress);
    return fetch;
  }

  function _emscripten_throw_string(str) {
      assert(typeof str === 'number');
      throw UTF8ToString(str);
    }

  
  
  var GL={counter:1,lastError:0,buffers:[],mappedBuffers:{},programs:[],framebuffers:[],renderbuffers:[],textures:[],uniforms:[],shaders:[],vaos:[],contexts:{},currentContext:null,offscreenCanvases:{},timerQueriesEXT:[],queries:[],samplers:[],transformFeedbacks:[],syncs:[],programInfos:{},stringCache:{},stringiCache:{},unpackAlignment:4,init:function() {
        GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
        for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
          GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i+1);
        }
      },recordError:function recordError(errorCode) {
        if (!GL.lastError) {
          GL.lastError = errorCode;
        }
      },getNewId:function(table) {
        var ret = GL.counter++;
        for (var i = table.length; i < ret; i++) {
          table[i] = null;
        }
        return ret;
      },MINI_TEMP_BUFFER_SIZE:256,miniTempBuffer:null,miniTempBufferViews:[0],getSource:function(shader, count, string, length) {
        var source = '';
        for (var i = 0; i < count; ++i) {
          var len = length ? HEAP32[(((length)+(i*4))>>2)] : -1;
          source += UTF8ToString(HEAP32[(((string)+(i*4))>>2)], len < 0 ? undefined : len);
        }
        return source;
      },createContext:function(canvas, webGLContextAttributes) {
  
  
  
  
        var ctx = 
          (webGLContextAttributes.majorVersion > 1) ? canvas.getContext("webgl2", webGLContextAttributes) :
          (canvas.getContext("webgl", webGLContextAttributes) || canvas.getContext("experimental-webgl", webGLContextAttributes));
  
  
        return ctx && GL.registerContext(ctx, webGLContextAttributes);
      },registerContext:function(ctx, webGLContextAttributes) {
        var handle = _malloc(8); // Make space on the heap to store GL context attributes that need to be accessible as shared between threads.
        var context = {
          handle: handle,
          attributes: webGLContextAttributes,
          version: webGLContextAttributes.majorVersion,
          GLctx: ctx
        };
  
        // BUG: Workaround Chrome WebGL 2 issue: the first shipped versions of WebGL 2 in Chrome did not actually implement the new WebGL 2 functions.
        //      Those are supported only in Chrome 58 and newer.
        function getChromeVersion() {
          var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
          return raw ? parseInt(raw[2], 10) : false;
        }
        context.supportsWebGL2EntryPoints = (context.version >= 2) && (getChromeVersion() === false || getChromeVersion() >= 58);
  
  
        // Store the created context object so that we can access the context given a canvas without having to pass the parameters again.
        if (ctx.canvas) ctx.canvas.GLctxObject = context;
        GL.contexts[handle] = context;
        if (typeof webGLContextAttributes.enableExtensionsByDefault === 'undefined' || webGLContextAttributes.enableExtensionsByDefault) {
          GL.initExtensions(context);
        }
  
  
  
  
        return handle;
      },makeContextCurrent:function(contextHandle) {
  
        GL.currentContext = GL.contexts[contextHandle]; // Active Emscripten GL layer context object.
        Module.ctx = GLctx = GL.currentContext && GL.currentContext.GLctx; // Active WebGL context object.
        return !(contextHandle && !GLctx);
      },getContext:function(contextHandle) {
        return GL.contexts[contextHandle];
      },deleteContext:function(contextHandle) {
        if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = null;
        if (typeof JSEvents === 'object') JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas); // Release all JS event handlers on the DOM element that the GL context is associated with since the context is now deleted.
        if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined; // Make sure the canvas object no longer refers to the context object so there are no GC surprises.
        _free(GL.contexts[contextHandle]);
        GL.contexts[contextHandle] = null;
      },initExtensions:function(context) {
        // If this function is called without a specific context object, init the extensions of the currently active context.
        if (!context) context = GL.currentContext;
  
        if (context.initExtensionsDone) return;
        context.initExtensionsDone = true;
  
        var GLctx = context.GLctx;
  
        // Detect the presence of a few extensions manually, this GL interop layer itself will need to know if they exist.
  
        if (context.version < 2) {
          // Extension available from Firefox 26 and Google Chrome 30
          var instancedArraysExt = GLctx.getExtension('ANGLE_instanced_arrays');
          if (instancedArraysExt) {
            GLctx['vertexAttribDivisor'] = function(index, divisor) { instancedArraysExt['vertexAttribDivisorANGLE'](index, divisor); };
            GLctx['drawArraysInstanced'] = function(mode, first, count, primcount) { instancedArraysExt['drawArraysInstancedANGLE'](mode, first, count, primcount); };
            GLctx['drawElementsInstanced'] = function(mode, count, type, indices, primcount) { instancedArraysExt['drawElementsInstancedANGLE'](mode, count, type, indices, primcount); };
          }
  
          // Extension available from Firefox 25 and WebKit
          var vaoExt = GLctx.getExtension('OES_vertex_array_object');
          if (vaoExt) {
            GLctx['createVertexArray'] = function() { return vaoExt['createVertexArrayOES'](); };
            GLctx['deleteVertexArray'] = function(vao) { vaoExt['deleteVertexArrayOES'](vao); };
            GLctx['bindVertexArray'] = function(vao) { vaoExt['bindVertexArrayOES'](vao); };
            GLctx['isVertexArray'] = function(vao) { return vaoExt['isVertexArrayOES'](vao); };
          }
  
          var drawBuffersExt = GLctx.getExtension('WEBGL_draw_buffers');
          if (drawBuffersExt) {
            GLctx['drawBuffers'] = function(n, bufs) { drawBuffersExt['drawBuffersWEBGL'](n, bufs); };
          }
        }
  
        GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query");
  
        // These are the 'safe' feature-enabling extensions that don't add any performance impact related to e.g. debugging, and
        // should be enabled by default so that client GLES2/GL code will not need to go through extra hoops to get its stuff working.
        // As new extensions are ratified at http://www.khronos.org/registry/webgl/extensions/ , feel free to add your new extensions
        // here, as long as they don't produce a performance impact for users that might not be using those extensions.
        // E.g. debugging-related extensions should probably be off by default.
        var automaticallyEnabledExtensions = [ // Khronos ratified WebGL extensions ordered by number (no debug extensions):
                                               "OES_texture_float", "OES_texture_half_float", "OES_standard_derivatives",
                                               "OES_vertex_array_object", "WEBGL_compressed_texture_s3tc", "WEBGL_depth_texture",
                                               "OES_element_index_uint", "EXT_texture_filter_anisotropic", "EXT_frag_depth",
                                               "WEBGL_draw_buffers", "ANGLE_instanced_arrays", "OES_texture_float_linear",
                                               "OES_texture_half_float_linear", "EXT_blend_minmax", "EXT_shader_texture_lod",
                                               // Community approved WebGL extensions ordered by number:
                                               "WEBGL_compressed_texture_pvrtc", "EXT_color_buffer_half_float", "WEBGL_color_buffer_float",
                                               "EXT_sRGB", "WEBGL_compressed_texture_etc1", "EXT_disjoint_timer_query",
                                               "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_astc", "EXT_color_buffer_float",
                                               "WEBGL_compressed_texture_s3tc_srgb", "EXT_disjoint_timer_query_webgl2"];
  
        function shouldEnableAutomatically(extension) {
          var ret = false;
          automaticallyEnabledExtensions.forEach(function(include) {
            if (extension.indexOf(include) != -1) {
              ret = true;
            }
          });
          return ret;
        }
  
        var exts = GLctx.getSupportedExtensions();
        if (exts && exts.length > 0) {
          GLctx.getSupportedExtensions().forEach(function(ext) {
            if (automaticallyEnabledExtensions.indexOf(ext) != -1) {
              GLctx.getExtension(ext); // Calling .getExtension enables that extension permanently, no need to store the return value to be enabled.
            }
          });
        }
      },populateUniformTable:function(program) {
        var p = GL.programs[program];
        var ptable = GL.programInfos[program] = {
          uniforms: {},
          maxUniformLength: 0, // This is eagerly computed below, since we already enumerate all uniforms anyway.
          maxAttributeLength: -1, // This is lazily computed and cached, computed when/if first asked, "-1" meaning not computed yet.
          maxUniformBlockNameLength: -1 // Lazily computed as well
        };
  
        var utable = ptable.uniforms;
        // A program's uniform table maps the string name of an uniform to an integer location of that uniform.
        // The global GL.uniforms map maps integer locations to WebGLUniformLocations.
        var numUniforms = GLctx.getProgramParameter(p, 0x8B86/*GL_ACTIVE_UNIFORMS*/);
        for (var i = 0; i < numUniforms; ++i) {
          var u = GLctx.getActiveUniform(p, i);
  
          var name = u.name;
          ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length+1);
  
          // If we are dealing with an array, e.g. vec4 foo[3], strip off the array index part to canonicalize that "foo", "foo[]",
          // and "foo[0]" will mean the same. Loop below will populate foo[1] and foo[2].
          if (name.slice(-1) == ']') {
            name = name.slice(0, name.lastIndexOf('['));
          }
  
          // Optimize memory usage slightly: If we have an array of uniforms, e.g. 'vec3 colors[3];', then
          // only store the string 'colors' in utable, and 'colors[0]', 'colors[1]' and 'colors[2]' will be parsed as 'colors'+i.
          // Note that for the GL.uniforms table, we still need to fetch the all WebGLUniformLocations for all the indices.
          var loc = GLctx.getUniformLocation(p, name);
          if (loc) {
            var id = GL.getNewId(GL.uniforms);
            utable[name] = [u.size, id];
            GL.uniforms[id] = loc;
  
            for (var j = 1; j < u.size; ++j) {
              var n = name + '['+j+']';
              loc = GLctx.getUniformLocation(p, n);
              id = GL.getNewId(GL.uniforms);
  
              GL.uniforms[id] = loc;
            }
          }
        }
      }};
  
  var JSEvents={keyEvent:0,mouseEvent:0,wheelEvent:0,uiEvent:0,focusEvent:0,deviceOrientationEvent:0,deviceMotionEvent:0,fullscreenChangeEvent:0,pointerlockChangeEvent:0,visibilityChangeEvent:0,touchEvent:0,previousFullscreenElement:null,previousScreenX:null,previousScreenY:null,removeEventListenersRegistered:false,removeAllEventListeners:function() {
        for(var i = JSEvents.eventHandlers.length-1; i >= 0; --i) {
          JSEvents._removeHandler(i);
        }
        JSEvents.eventHandlers = [];
        JSEvents.deferredCalls = [];
      },deferredCalls:[],deferCall:function(targetFunction, precedence, argsList) {
        function arraysHaveEqualContent(arrA, arrB) {
          if (arrA.length != arrB.length) return false;
  
          for(var i in arrA) {
            if (arrA[i] != arrB[i]) return false;
          }
          return true;
        }
        // Test if the given call was already queued, and if so, don't add it again.
        for(var i in JSEvents.deferredCalls) {
          var call = JSEvents.deferredCalls[i];
          if (call.targetFunction == targetFunction && arraysHaveEqualContent(call.argsList, argsList)) {
            return;
          }
        }
        JSEvents.deferredCalls.push({
          targetFunction: targetFunction,
          precedence: precedence,
          argsList: argsList
        });
  
        JSEvents.deferredCalls.sort(function(x,y) { return x.precedence < y.precedence; });
      },removeDeferredCalls:function(targetFunction) {
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
            JSEvents.deferredCalls.splice(i, 1);
            --i;
          }
        }
      },canPerformEventHandlerRequests:function() {
        return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
      },runDeferredCalls:function() {
        if (!JSEvents.canPerformEventHandlerRequests()) {
          return;
        }
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          var call = JSEvents.deferredCalls[i];
          JSEvents.deferredCalls.splice(i, 1);
          --i;
          call.targetFunction.apply(this, call.argsList);
        }
      },inEventHandler:0,currentEventHandler:null,eventHandlers:[],isInternetExplorer:function() { return navigator.userAgent.indexOf('MSIE') !== -1 || navigator.appVersion.indexOf('Trident/') > 0; },removeAllHandlersOnTarget:function(target, eventTypeString) {
        for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
          if (JSEvents.eventHandlers[i].target == target && 
            (!eventTypeString || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
             JSEvents._removeHandler(i--);
           }
        }
      },_removeHandler:function(i) {
        var h = JSEvents.eventHandlers[i];
        h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
        JSEvents.eventHandlers.splice(i, 1);
      },registerOrRemoveHandler:function(eventHandler) {
        var jsEventHandler = function jsEventHandler(event) {
          // Increment nesting count for the event handler.
          ++JSEvents.inEventHandler;
          JSEvents.currentEventHandler = eventHandler;
          // Process any old deferred calls the user has placed.
          JSEvents.runDeferredCalls();
          // Process the actual event, calls back to user C code handler.
          eventHandler.handlerFunc(event);
          // Process any new deferred calls that were placed right now from this event handler.
          JSEvents.runDeferredCalls();
          // Out of event handler - restore nesting count.
          --JSEvents.inEventHandler;
        }
        
        if (eventHandler.callbackfunc) {
          eventHandler.eventListenerFunc = jsEventHandler;
          eventHandler.target.addEventListener(eventHandler.eventTypeString, jsEventHandler, eventHandler.useCapture);
          JSEvents.eventHandlers.push(eventHandler);
        } else {
          for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
            if (JSEvents.eventHandlers[i].target == eventHandler.target
             && JSEvents.eventHandlers[i].eventTypeString == eventHandler.eventTypeString) {
               JSEvents._removeHandler(i--);
             }
          }
        }
      },getBoundingClientRectOrZeros:function(target) {
        return target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0 };
      },pageScrollPos:function() {
        if (pageXOffset > 0 || pageYOffset > 0) {
          return [pageXOffset, pageYOffset];
        }
        if (typeof document.documentElement.scrollLeft !== 'undefined' || typeof document.documentElement.scrollTop !== 'undefined') {
          return [document.documentElement.scrollLeft, document.documentElement.scrollTop];
        }
        return [document.body.scrollLeft|0, document.body.scrollTop|0];
      },getNodeNameForTarget:function(target) {
        if (!target) return '';
        if (target == window) return '#window';
        if (target == screen) return '#screen';
        return (target && target.nodeName) ? target.nodeName : '';
      },tick:function() {
        if (window['performance'] && window['performance']['now']) return window['performance']['now']();
        else return Date.now();
      },fullscreenEnabled:function() {
        return document.fullscreenEnabled || document.mozFullScreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
      }};
  
  var __emscripten_webgl_power_preferences=['default', 'low-power', 'high-performance'];
  
  
  function __maybeCStringToJsString(cString) {
      return cString === cString + 0 ? UTF8ToString(cString) : cString;
    }
  
  var __specialEventTargets=[0, document, window];function __findEventTarget(target) {
      var domElement = __specialEventTargets[target] || document.querySelector(__maybeCStringToJsString(target));
      // TODO: Remove this check in the future, or move it to some kind of debugging mode, because it may be perfectly fine behavior
      // for one to query an event target to test if any DOM element with given CSS selector exists. However for a migration period
      // from old lookup over to new, it is very useful to get diagnostics messages related to a lookup failing.
      if (!domElement) err('No DOM element was found with CSS selector "' + __maybeCStringToJsString(target) + '"');
      return domElement;
    }
  
  function __findCanvasEventTarget(target) { return __findEventTarget(target); }function _emscripten_webgl_do_create_context(target, attributes) {
      assert(attributes);
      var contextAttributes = {};
      var a = attributes >> 2;
      contextAttributes['alpha'] = !!HEAP32[a + (0>>2)];
      contextAttributes['depth'] = !!HEAP32[a + (4>>2)];
      contextAttributes['stencil'] = !!HEAP32[a + (8>>2)];
      contextAttributes['antialias'] = !!HEAP32[a + (12>>2)];
      contextAttributes['premultipliedAlpha'] = !!HEAP32[a + (16>>2)];
      contextAttributes['preserveDrawingBuffer'] = !!HEAP32[a + (20>>2)];
      var powerPreference = HEAP32[a + (24>>2)];
      contextAttributes['powerPreference'] = __emscripten_webgl_power_preferences[powerPreference];
      contextAttributes['failIfMajorPerformanceCaveat'] = !!HEAP32[a + (28>>2)];
      contextAttributes.majorVersion = HEAP32[a + (32>>2)];
      contextAttributes.minorVersion = HEAP32[a + (36>>2)];
      contextAttributes.enableExtensionsByDefault = HEAP32[a + (40>>2)];
      contextAttributes.explicitSwapControl = HEAP32[a + (44>>2)];
      contextAttributes.proxyContextToMainThread = HEAP32[a + (48>>2)];
      contextAttributes.renderViaOffscreenBackBuffer = HEAP32[a + (52>>2)];
  
      var canvas = __findCanvasEventTarget(target);
  
  
  
      if (!canvas) {
        return 0;
      }
  
      if (contextAttributes.explicitSwapControl) {
        return 0;
      }
  
  
      var contextHandle = GL.createContext(canvas, contextAttributes);
      return contextHandle;
    }function _emscripten_webgl_create_context(a0,a1
  ) {
  return _emscripten_webgl_do_create_context(a0,a1);
  }

  function _emscripten_webgl_init_context_attributes(attributes) {
      assert(attributes);
      var a = attributes >> 2;
      for(var i = 0; i < (56>>2); ++i) {
        HEAP32[a+i] = 0;
      }
  
      HEAP32[a + (0>>2)] =
      HEAP32[a + (4>>2)] = 
      HEAP32[a + (12>>2)] = 
      HEAP32[a + (16>>2)] = 
      HEAP32[a + (32>>2)] = 
      HEAP32[a + (40>>2)] = 1;
  
    }

  function _emscripten_webgl_make_context_current(contextHandle) {
      var success = GL.makeContextCurrent(contextHandle);
      return success ? 0 : -5;
    }

  function _exit(status) {
      throw 'exit(' + status + ')';
    }

  function _glAttachShader(program, shader) {
      GLctx.attachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _glBindAttribLocation(program, index, name) {
      GLctx.bindAttribLocation(GL.programs[program], index, UTF8ToString(name));
    }

  function _glBindBuffer(target, buffer) {
  
      if (target == 0x88EB /*GL_PIXEL_PACK_BUFFER*/) {
        // In WebGL 2 glReadPixels entry point, we need to use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_PACK_BUFFER_BINDING point, so must keep track whether that binding point is non-null to know what is
        // the proper API function to call.
        GLctx.currentPixelPackBufferBinding = buffer;
      } else if (target == 0x88EC /*GL_PIXEL_UNPACK_BUFFER*/) {
        // In WebGL 2 gl(Compressed)Tex(Sub)Image[23]D entry points, we need to
        // use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_UNPACK_BUFFER_BINDING point, so must keep track whether that
        // binding point is non-null to know what is the proper API function to
        // call.
        GLctx.currentPixelUnpackBufferBinding = buffer;
      }
      GLctx.bindBuffer(target, GL.buffers[buffer]);
    }

  function _glBindTexture(target, texture) {
      GLctx.bindTexture(target, GL.textures[texture]);
    }

  function _glBlendFuncSeparate(x0, x1, x2, x3) { GLctx['blendFuncSeparate'](x0, x1, x2, x3) }

  function _glBufferData(target, size, data, usage) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (data) {
          GLctx.bufferData(target, HEAPU8, usage, data, size);
        } else {
          GLctx.bufferData(target, size, usage);
        }
      } else {
        // N.b. here first form specifies a heap subarray, second form an integer size, so the ?: code here is polymorphic. It is advised to avoid
        // randomly mixing both uses in calling code, to avoid any potential JS engine JIT issues.
        GLctx.bufferData(target, data ? HEAPU8.subarray(data, data+size) : size, usage);
      }
    }

  function _glBufferSubData(target, offset, size, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.bufferSubData(target, offset, HEAPU8, data, size);
        return;
      }
      GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data+size));
    }

  function _glClear(x0) { GLctx['clear'](x0) }

  function _glClearColor(x0, x1, x2, x3) { GLctx['clearColor'](x0, x1, x2, x3) }

  function _glCompileShader(shader) {
      GLctx.compileShader(GL.shaders[shader]);
    }

  function _glCreateProgram() {
      var id = GL.getNewId(GL.programs);
      var program = GLctx.createProgram();
      program.name = id;
      GL.programs[id] = program;
      return id;
    }

  function _glCreateShader(shaderType) {
      var id = GL.getNewId(GL.shaders);
      GL.shaders[id] = GLctx.createShader(shaderType);
      return id;
    }

  function _glDeleteProgram(id) {
      if (!id) return;
      var program = GL.programs[id];
      if (!program) { // glDeleteProgram actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteProgram(program);
      program.name = 0;
      GL.programs[id] = null;
      GL.programInfos[id] = null;
    }

  function _glDeleteShader(id) {
      if (!id) return;
      var shader = GL.shaders[id];
      if (!shader) { // glDeleteShader actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteShader(shader);
      GL.shaders[id] = null;
    }

  function _glDeleteTextures(n, textures) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((textures)+(i*4))>>2)];
        var texture = GL.textures[id];
        if (!texture) continue; // GL spec: "glDeleteTextures silently ignores 0s and names that do not correspond to existing textures".
        GLctx.deleteTexture(texture);
        texture.name = 0;
        GL.textures[id] = null;
      }
    }

  function _glDisable(x0) { GLctx['disable'](x0) }

  function _glDisableVertexAttribArray(index) {
      GLctx.disableVertexAttribArray(index);
    }

  function _glDrawArrays(mode, first, count) {
  
      GLctx.drawArrays(mode, first, count);
  
    }

  function _glDrawElements(mode, count, type, indices) {
  
      GLctx.drawElements(mode, count, type, indices);
  
    }

  function _glEnable(x0) { GLctx['enable'](x0) }

  function _glEnableVertexAttribArray(index) {
      GLctx.enableVertexAttribArray(index);
    }

  
  function __glGenObject(n, buffers, createFunction, objectTable
      ) {
      for (var i = 0; i < n; i++) {
        var buffer = GLctx[createFunction]();
        var id = buffer && GL.getNewId(objectTable);
        if (buffer) {
          buffer.name = id;
          objectTable[id] = buffer;
        } else {
          GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        }
        HEAP32[(((buffers)+(i*4))>>2)]=id;
      }
    }function _glGenBuffers(n, buffers) {
      __glGenObject(n, buffers, 'createBuffer', GL.buffers
        );
    }

  function _glGenTextures(n, textures) {
      __glGenObject(n, textures, 'createTexture', GL.textures
        );
    }

  function _glGetActiveUniform(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveUniform(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size, type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _glGetProgramInfoLog(program, maxLength, length, infoLog) {
      var log = GLctx.getProgramInfoLog(GL.programs[program]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetProgramiv(program, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      if (program >= GL.counter) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      var ptable = GL.programInfos[program];
      if (!ptable) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        return;
      }
  
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getProgramInfoLog(GL.programs[program]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B87 /* GL_ACTIVE_UNIFORM_MAX_LENGTH */) {
        HEAP32[((p)>>2)]=ptable.maxUniformLength;
      } else if (pname == 0x8B8A /* GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */) {
        if (ptable.maxAttributeLength == -1) {
          program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, 0x8B89/*GL_ACTIVE_ATTRIBUTES*/);
          ptable.maxAttributeLength = 0; // Spec says if there are no active attribs, 0 must be returned.
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxAttributeLength;
      } else if (pname == 0x8A35 /* GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH */) {
        if (ptable.maxUniformBlockNameLength == -1) {
          program = GL.programs[program];
          var numBlocks = GLctx.getProgramParameter(program, 0x8A36/*GL_ACTIVE_UNIFORM_BLOCKS*/);
          ptable.maxUniformBlockNameLength = 0;
          for (var i = 0; i < numBlocks; ++i) {
            var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
            ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxUniformBlockNameLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getProgramParameter(GL.programs[program], pname);
      }
    }

  function _glGetShaderInfoLog(shader, maxLength, length, infoLog) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetShaderiv(shader, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B88) { // GL_SHADER_SOURCE_LENGTH
        var source = GLctx.getShaderSource(GL.shaders[shader]);
        var sourceLength = (source === null || source.length == 0) ? 0 : source.length + 1;
        HEAP32[((p)>>2)]=sourceLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getShaderParameter(GL.shaders[shader], pname);
      }
    }

  function _glGetUniformLocation(program, name) {
      name = UTF8ToString(name);
  
      var arrayIndex = 0;
      // If user passed an array accessor "[index]", parse the array index off the accessor.
      if (name[name.length - 1] == ']') {
        var leftBrace = name.lastIndexOf('[');
        arrayIndex = name[leftBrace+1] != ']' ? parseInt(name.slice(leftBrace + 1)) : 0; // "index]", parseInt will ignore the ']' at the end; but treat "foo[]" as "foo[0]"
        name = name.slice(0, leftBrace);
      }
  
      var uniformInfo = GL.programInfos[program] && GL.programInfos[program].uniforms[name]; // returns pair [ dimension_of_uniform_array, uniform_location ]
      if (uniformInfo && arrayIndex >= 0 && arrayIndex < uniformInfo[0]) { // Check if user asked for an out-of-bounds element, i.e. for 'vec4 colors[3];' user could ask for 'colors[10]' which should return -1.
        return uniformInfo[1] + arrayIndex;
      } else {
        return -1;
      }
    }

  function _glLinkProgram(program) {
      GLctx.linkProgram(GL.programs[program]);
      GL.populateUniformTable(program);
    }

  function _glPixelStorei(pname, param) {
      if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
        GL.unpackAlignment = param;
      }
      GLctx.pixelStorei(pname, param);
    }

  function _glScissor(x0, x1, x2, x3) { GLctx['scissor'](x0, x1, x2, x3) }

  function _glShaderSource(shader, count, string, length) {
      var source = GL.getSource(shader, count, string, length);
  
  
      GLctx.shaderSource(GL.shaders[shader], source);
    }

  function _glTexParameteri(x0, x1, x2) { GLctx['texParameteri'](x0, x1, x2) }

  function _glUniform1i(location, v0) {
      GLctx.uniform1i(GL.uniforms[location], v0);
    }

  function _glUniform3fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform3fv(GL.uniforms[location], HEAPF32, value>>2, count*3);
        return;
      }
  
      if (3*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[3*count-1];
        for (var i = 0; i < 3*count; i += 3) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*12)>>2);
      }
      GLctx.uniform3fv(GL.uniforms[location], view);
    }

  function _glUniform4fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform4fv(GL.uniforms[location], HEAPF32, value>>2, count*4);
        return;
      }
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniform4fv(GL.uniforms[location], view);
    }

  function _glUniformMatrix3fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*9);
        return;
      }
  
      if (9*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[9*count-1];
        for (var i = 0; i < 9*count; i += 9) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*36)>>2);
      }
      GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, view);
    }

  function _glUseProgram(program) {
      GLctx.useProgram(GL.programs[program]);
    }

  function _glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
      GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
    }

  function _glViewport(x0, x1, x2, x3) { GLctx['viewport'](x0, x1, x2, x3) }

  function _js_canvasBlendingAndSmoothing(blend, smooth) {
        var context = ut._HTML.canvasContext;
        context.globalCompositeOperation = ([ 'source-over', 'lighter', 'multiply', 'destination-in' ])[blend];
        context.imageSmoothingEnabled = smooth;
      }

  function _js_canvasClear(r,g,b,a,w,h) {
          var cx = ut._HTML.canvasContext;
          cx.globalCompositeOperation = 'copy';
          cx.globalAlpha = 1.0;
          cx.fillStyle = 'rgba(' + (r | 0) + ', ' + (g | 0) + ', ' + (b | 0) + ', ' + a + ')';
          cx.fillRect(0, 0, w, h);
      }

  function _js_canvasInit(){
          var cx = ut._HTML.canvasContext;
          if (!cx || !cx.save)
            return false;
          cx.save();
          cx.globalCompositeOperation = 'multiply';
          ut._HTML.supportMultiply = cx.globalCompositeOperation == 'multiply';
          cx.restore();
          return true;
      }

  function _js_canvasMakePattern(tintedIndex) {
        // tinted sprite has to be made first!
        var context = ut._HTML.canvasContext;
        var img = ut._HTML.tintedSprites[tintedIndex].image;
        ut._HTML.tintedSprites[tintedIndex].pattern = context.createPattern ( img, 'repeat');
      }

  function _js_canvasMakeTintedSprite(imageIndex, sx, sy, sw, sh, r, g, b) {
        var context = ut._HTML.canvasContext;
        // make a temp canvas
        var canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        var cx = canvas.getContext('2d');
        var srcimg = ut._HTML.images[imageIndex].image;
        // initialize temp with with image
        cx.globalCompositeOperation = 'copy';
        cx.drawImage(srcimg, sx, sy, sw, sh, 0, 0, sw, sh);
        // check case for r==g==b==255, which can happen with non-pattern tiling as we reuse the tint cache there 
        if ((r&g&b)!==255) {
          if (!ut._HTML.supportMultiply) {
            // fall back to software if context does not support multiply like for example the wechat platform
            var imd = cx.getImageData(0,0,sw,sh);
            var s = sw*sh*4;
            var da = imd.data;
            var scaleR = ((r / 255.0)*256.0)|0;
            var scaleG = ((g / 255.0)*256.0)|0;
            var scaleB = ((b / 255.0)*256.0)|0;
            for (var i=0; i<s; i+=4) {
              da[i] = (da[i]*scaleR)>>8;
              da[i+1] = (da[i+1]*scaleG)>>8;
              da[i+2] = (da[i+2]*scaleB)>>8;
            }
            cx.putImageData(imd,0,0);
          } else {
            // multiply with color (unfortunately sets alpha=1)
            cx.globalCompositeOperation = 'multiply';
            cx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
            cx.fillRect(0, 0, sw, sh);
            // take alpha channel from image again
            cx.globalCompositeOperation = 'destination-in';
            cx.drawImage(srcimg, sx, sy, sw, sh, 0, 0, sw, sh);
          }
        }
        // grab first free index
        var idx;
        if ( ut._HTML.tintedSpritesFreeList.length===0 )
          idx = ut._HTML.tintedSprites.length;
        else
          idx = ut._HTML.tintedSpritesFreeList.pop();
        // put the canvas into tinted
        ut._HTML.tintedSprites[idx] = { image : canvas, pattern : null };
        return idx;
      }

  function _js_canvasReleaseTintedSprite(tintedIndex) {
        ut._HTML.tintedSprites[tintedIndex] = null;
        ut._HTML.tintedSpritesFreeList.push(tintedIndex);
      }

  function _js_canvasRenderMultipleSliced(tintIndex, imageIndex, v, n, alpha) {
        var cx = ut._HTML.canvasContext;
        cx.globalAlpha = alpha;
        var img = tintIndex > 0 ? ut._HTML.tintedSprites[tintIndex].image : ut._HTML.images[imageIndex].image;
        // draw all images
        var i8 = v >> 2;
        for (var i = 0; i < n; i++) {
          if ( HEAPF32[i8 + 2] > 0 && HEAPF32[i8 + 3] > 0 ) // have to check zero source rect for firefox
            cx.drawImage(img, HEAPF32[i8], HEAPF32[i8 + 1], HEAPF32[i8 + 2], HEAPF32[i8 + 3],
              HEAPF32[i8 + 4], -HEAPF32[i8 + 7] - HEAPF32[i8 + 5], HEAPF32[i8 + 6], HEAPF32[i8 + 7]);
          i8 += 8;
        }
      }

  function _js_canvasRenderNormalSpriteTinted(txa, txb, txc, txd, txe, txf, alpha,
        tintedIndex, x, y, w, h) {
        var context = ut._HTML.canvasContext;
        context.setTransform(txa, txb, txc, txd, txe, txf);
        context.globalAlpha = alpha;
        context.drawImage(ut._HTML.tintedSprites[tintedIndex].image, x, y, w, h);
      }

  function _js_canvasRenderNormalSpriteWhite(txa, txb, txc, txd, txe, txf, alpha,
        imageIndex, sx, sy, sw, sh, x, y, w, h) {
        var context = ut._HTML.canvasContext;
        context.setTransform(txa, txb, txc, txd, txe, txf);
        context.globalAlpha = alpha;
        context.drawImage(ut._HTML.images[imageIndex].image, sx, sy, sw, sh, x, y, w, h);
      }

  function _js_canvasRenderPatternSprite(patternIdx, x, y, w, h, txa, txb, txc, txd, txe, txf, alpha) {
        // draw clipping path (note: base tx must be set!)
        var cx = ut._HTML.canvasContext;
        cx.globalAlpha = alpha;
        cx.save();
        cx.beginPath();
        cx.rect(x, y, w, h);
        cx.clip(); // TODO: test if this works with camera clip rectangles!
        // set a transform for the pattern!
        cx.setTransform(txa, txb, txc, txd, txe, txf);
        // draw a huge filled rect
        cx.fillStyle = ut._HTML.tintedSprites[patternIdx].pattern;
        cx.fillRect(0, -10000, 10000, 10000);
        // reset clipping
        cx.restore();
      }

  function _js_canvasSetTransformOnly(txa, txb, txc, txd, txe, txf) {
        var context = ut._HTML.canvasContext;
        context.setTransform(txa, txb, txc, txd, txe, txf);
      }

  function _js_html_audioCheckLoad(audioClipIdx) {
          var WORKING_ON_IT = 0;
          var SUCCESS = 1;
          var FAILED = 2;
  
          if (!this.audioContext || audioClipIdx < 0)
              return FAILED;
          if (this.audioBuffers[audioClipIdx] == null)
              return FAILED;
          if (this.audioBuffers[audioClipIdx] === 'loading')
              return WORKING_ON_IT; 
          if (this.audioBuffers[audioClipIdx] === 'error')
              return FAILED;
          return SUCCESS;
      }

  function _js_html_audioFree(audioClipIdx) {
          var audioBuffer = this.audioBuffers[audioClipIdx];
          if (!audioBuffer)
              return;
  
          for (var i = 0; i < this.audioSources.length; ++i) {
              var sourceNode = this.audioSources[i];
              if (sourceNode && sourceNode.buffer === audioBuffer)
                  sourceNode.stop();
          }
  
          this.audioBuffers[audioClipIdx] = null;
      }

  function _js_html_audioIsPlaying(audioSourceIdx) {
          if (!this.audioContext || audioSourceIdx < 0)
              return false;
  
          if (this.audioSources[audioSourceIdx] == null)
              return false;
  
          return this.audioSources[audioSourceIdx].isPlaying;
      }

  function _js_html_audioIsUnlocked() {
          return this.unlocked;
      }

  function _js_html_audioPause() {
          if (!this.audioContext)
              return;
  
          this.audioContext.suspend();
      }

  function _js_html_audioPlay(audioClipIdx, audioSourceIdx, volume, loop) 
      {
          if (!this.audioContext || audioClipIdx < 0 || audioSourceIdx < 0)
              return false;
  
          if (this.audioContext.state !== 'running')
              return false;
  
          // require audio buffer to be loaded
          var srcBuffer = this.audioBuffers[audioClipIdx];
          if (!srcBuffer || typeof srcBuffer === 'string')
              return false;
  
          // create audio source node
          var sourceNode = this.audioContext.createBufferSource();
          sourceNode.buffer = srcBuffer;
  
          // create gain node if needed
          if (volume !== 1.0) {
              var gainNode = this.audioContext.createGain();
              gainNode.gain.setValueAtTime(volume, 0);
              sourceNode.connect(gainNode);
              gainNode.connect(this.audioContext.destination);
          } else {
              sourceNode.connect(this.audioContext.destination);
          }
  
          // loop value
          sourceNode.loop = loop;
  
          // stop audio source node if it is already playing
          this.stop(audioSourceIdx, true);
  
          // store audio source node
          this.audioSources[audioSourceIdx] = sourceNode;
  
          // on ended event
          var self = this;
          sourceNode.onended = function (event) {
              self.stop(audioSourceIdx, false);
              //console.log("onended callback");
              sourceNode.isPlaying = false;
          };
  
          // play audio source
          sourceNode.start();
          sourceNode.isPlaying = true;
          //console.log("[Audio] playing " + audioSourceIdx);
          return true;
      }

  function _js_html_audioResume() {
          if (!this.audioContext || typeof this.audioContext.resume !== 'function')
              return;
  
          this.audioContext.resume();
      }

  function _js_html_audioStartLoadFile(audioClipName, audioClipIdx) 
      {
          if (!this.audioContext || audioClipIdx < 0)
              return -1;
  
          audioClipName = UTF8ToString(audioClipName);
  
          var url = audioClipName;
          if (url.substring(0, 9) === "ut-asset:")
              url = UT_ASSETS[url.substring(9)];
  
          var self = this;
          var request = new XMLHttpRequest();
  
          self.audioBuffers[audioClipIdx] = 'loading';
          request.open('GET', url, true);
          request.responseType = 'arraybuffer';
          request.onload =
              function () {
                  self.audioContext.decodeAudioData(request.response, function (buffer) {
                      self.audioBuffers[audioClipIdx] = buffer;
                  });
              };
          request.onerror =
              function () {
                  self.audioBuffers[audioClipIdx] = 'error';
              };
          try {
              request.send();
              //Module._AudioService_AudioClip_OnLoading(entity,audioClipIdx);
          } catch (e) {
              // LG Nexus 5 + Android OS 4.4.0 + Google Chrome 30.0.1599.105 browser
              // odd behavior: If loading from base64-encoded data URI and the
              // format is unsupported, request.send() will immediately throw and
              // not raise the failure at .onerror() handler. Therefore catch
              // failures also eagerly from .send() above.
              self.audioBuffers[audioClipIdx] = 'error';
          }
  
          return audioClipIdx;
      }

  function _js_html_audioStop(audioSourceIdx, dostop) {
          if (!this.audioContext || audioSourceIdx < 0)
              return;
  
          // retrieve audio source node
          var sourceNode = this.audioSources[audioSourceIdx];
          if (!sourceNode)
              return;
  
          // forget audio source node
          sourceNode.onended = null;
          this.audioSources[audioSourceIdx] = null;
  
          // stop audio source
          if (dostop) {
              sourceNode.stop();
              sourceNode.isPlaying = false;
              //console.log("[Audio] stopping " + audioSourceIdx);
          }
      }

  function _js_html_audioUnlock() {
          var self = this;
          if (self.unlocked || !self.audioContext ||
              typeof self.audioContext.resume !== 'function')
              return;
  
          // setup a touch start listener to attempt an unlock in
          document.addEventListener('click', ut._HTML.unlock, true);
          document.addEventListener('touchstart', ut._HTML.unlock, true);
          document.addEventListener('touchend', ut._HTML.unlock, true);
          document.addEventListener('keydown', ut._HTML.unlock, true);
          document.addEventListener('keyup', ut._HTML.unlock, true);
      }

  function _js_html_checkLoadImage(idx) {
      var img = ut._HTML.images[idx];
  
      if ( img.loaderror ) {
        return 2;
      }
  
      if (img.image) {
        if (!img.image.complete || !img.image.naturalWidth || !img.image.naturalHeight)
          return 0; // null - not yet loaded
      }
  
      if (img.mask) {
        if (!img.mask.complete || !img.mask.naturalWidth || !img.mask.naturalHeight)
          return 0; // null - not yet loaded
      }
  
      return 1; // ok
    }

  function _js_html_extractAlphaFromImage(idx, destPtr, w, h) {
      var cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      var cx = cvs.getContext('2d');
      var srcimg = ut._HTML.images[idx].image;
      cx.globalCompositeOperation = 'copy';
      cx.drawImage(srcimg, 0, 0, w, h);
      var pixels = cx.getImageData(0, 0, w, h);
      var src = pixels.data;
      for (var o = 0; o < w * h; o++)
        HEAPU8[destPtr+o] = src[o * 4 + 3];
    }

  function _js_html_finishLoadImage(idx, wPtr, hPtr, alphaPtr) {
      var img = ut._HTML.images[idx];
      // check three combinations of mask and image
      if (img.image && img.mask) { // image and mask, merge mask into image 
        var width = img.image.naturalWidth;
        var height = img.image.naturalHeight;
        var maskwidth = img.mask.naturalWidth;
        var maskheight = img.mask.naturalHeight;
  
        // construct the final image
        var cvscolor = document.createElement('canvas');
        cvscolor.width = width;
        cvscolor.height = height;
        var cxcolor = cvscolor.getContext('2d');
        cxcolor.globalCompositeOperation = 'copy';
        cxcolor.drawImage(img.image, 0, 0);
  
        var cvsalpha = document.createElement('canvas');
        cvsalpha.width = width;
        cvsalpha.height = height;
        var cxalpha = cvsalpha.getContext('2d');
        cxalpha.globalCompositeOperation = 'copy';
        cxalpha.drawImage(img.mask, 0, 0, width, height);
  
        var colorBits = cxcolor.getImageData(0, 0, width, height);
        var alphaBits = cxalpha.getImageData(0, 0, width, height);
        var cdata = colorBits.data, adata = alphaBits.data;
        var sz = width * height;
        for (var i = 0; i < sz; i++)
          cdata[(i<<2) + 3] = adata[i<<2];
        cxcolor.putImageData(colorBits, 0, 0);
  
        img.image = cvscolor;
        img.image.naturalWidth = width;
        img.image.naturalHeight = height; 
        img.hasAlpha = true; 
      } else if (!img.image && img.mask) { // mask only, create image
        var width = img.mask.naturalWidth;
        var height = img.mask.naturalHeight;
  
        // construct the final image: copy R to all channels 
        var cvscolor = document.createElement('canvas');
        cvscolor.width = width;
        cvscolor.height = height;
        var cxcolor = cvscolor.getContext('2d');
        cxcolor.globalCompositeOperation = 'copy';
        cxcolor.drawImage(img.mask, 0, 0);
  
        var colorBits = cxcolor.getImageData(0, 0, width, height);
        var cdata = colorBits.data;
        var sz = width * height;
        for (var i = 0; i < sz; i++) {
          cdata[(i<<2) + 1] = cdata[i<<2];
          cdata[(i<<2) + 2] = cdata[i<<2];
          cdata[(i<<2) + 3] = cdata[i<<2];
        }
        cxcolor.putImageData(colorBits, 0, 0);
  
        img.image = cvscolor;
        img.image.naturalWidth = width;
        img.image.naturalHeight = height; 
        img.hasAlpha = true; 
      } // else img.image only, nothing else to do here
  
      // done, return valid size and hasAlpha
      HEAP32[wPtr>>2] = img.image.naturalWidth;
      HEAP32[hPtr>>2] = img.image.naturalHeight;
      HEAP32[alphaPtr>>2] = img.hasAlpha;
    }

  function _js_html_freeImage(idx) {
      ut._HTML.images[idx] = null;
    }

  function _js_html_getCanvasSize(wPtr, hPtr) {
      var html = ut._HTML;
      HEAP32[wPtr>>2] = html.canvasElement.width | 0;
      HEAP32[hPtr>>2] = html.canvasElement.height | 0;
    }

  function _js_html_getFrameSize(wPtr, hPtr) {
      HEAP32[wPtr>>2] = window.innerWidth | 0;
      HEAP32[hPtr>>2] = window.innerHeight | 0;
    }

  function _js_html_getScreenSize(wPtr, hPtr) {
      HEAP32[wPtr>>2] = screen.width | 0;
      HEAP32[hPtr>>2] = screen.height | 0;
    }

  function _js_html_init() {
      ut = ut || {};
      ut._HTML = ut._HTML || {};
  
      var html = ut._HTML;
      html.visible = true;
      html.focused = true;
    }

  function _js_html_initAudio() {
          
          ut = ut || {};
          ut._HTML = ut._HTML || {};
  
          ut._HTML.unlock = function() {
          // call this method on touch start to create and play a buffer, then check
          // if the audio actually played to determine if audio has now been
          // unlocked on iOS, Android, etc.
              if (!self.audioContext)
                  return;
  
              // fix Android can not play in suspend state
              self.audioContext.resume();
  
              // create an empty buffer
              var source = self.audioContext.createBufferSource();
              source.buffer = self.audioContext.createBuffer(1, 1, 22050);
              source.connect(self.audioContext.destination);
  
              // play the empty buffer
              if (typeof source.start === 'undefined') {
                  source.noteOn(0);
              } else {
                  source.start(0);
              }
  
              // calling resume() on a stack initiated by user gesture is what
              // actually unlocks the audio on Android Chrome >= 55
              self.audioContext.resume();
  
              // setup a timeout to check that we are unlocked on the next event
              // loop
              source.onended = function () {
                  source.disconnect(0);
  
                  // update the unlocked state and prevent this check from happening
                  // again
                  self.unlocked = true;
                  //console.log("[Audio] unlocked");
  
                  // remove the touch start listener
                  document.removeEventListener('click', ut._HTML.unlock, true);
                  document.removeEventListener('touchstart', ut._HTML.unlock, true);
                  document.removeEventListener('touchend', ut._HTML.unlock, true);
                  document.removeEventListener('keydown', ut._HTML.unlock, true);
                  document.removeEventListener('keyup', ut._HTML.unlock, true);
              };
          };
  
          // audio initialization
          if (!window.AudioContext && !window.webkitAudioContext)
              return false;
  
          var audioContext =
              new (window.AudioContext || window.webkitAudioContext)();
          if (!audioContext)
              return false;
  
          this.audioContext = audioContext;
          this.audioBuffers = {};
          this.audioSources = {};
  
          // try to unlock audio
          this.unlocked = false;
          var navigator = (typeof window !== 'undefined' && window.navigator)
              ? window.navigator
              : null;
          var isMobile = /iPhone|iPad|iPod|Android|BlackBerry|BB10|Silk|Mobi/i.test(
              navigator && navigator.userAgent);
          var isTouch = !!(isMobile ||
              (navigator && navigator.maxTouchPoints > 0) ||
              (navigator && navigator.msMaxTouchPoints > 0));
          if (this.audioContext.state !== 'running' || isMobile || isTouch) {
              ut._HTML.unlock();
          } else {
              this.unlocked = true;
          }
          //console.log("[Audio] initialized " + (this.unlocked ? "unlocked" : "locked"));
          return true;
      }

  function _js_html_initImageLoading() {
      ut = ut || {};
      ut._HTML = ut._HTML || {};
  
      ut._HTML.images = [null];             // referenced by drawable, direct index to loaded image. maps 1:1 to Image2D component
                                      // { image, mask, loaderror, hasAlpha}
      ut._HTML.tintedSprites = [null];      // referenced by drawable, sub-sprite with colorization
                                      // { image, pattern }
      ut._HTML.tintedSpritesFreeList = [];
  
      // local helper functions
      ut._HTML.initImage = function(idx ) {
        ut._HTML.images[idx] = {
          image: null,
          mask: null,
          loaderror: false,
          hasAlpha: true,
          glTexture: null,
          glDisableSmoothing: false
        };
      };
  
      ut._HTML.ensureImageIsReadable = function (idx, w, h) {
        if (ut._HTML.canvasMode == 'webgl2' || ut._HTML.canvasMode == 'webgl') {
          var gl = ut._HTML.canvasContext;
          if (ut._HTML.images[idx].isrt) { // need to readback
            if (!ut._HTML.images[idx].glTexture)
              return false;
            // create fbo, read back bytes, write to image pixels
            var pixels = new Uint8Array(w*h*4);
            var fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ut._HTML.images[idx].glTexture, 0);
            gl.viewport(0,0,w,h);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)==gl.FRAMEBUFFER_COMPLETE) {
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            } else {
              console.log("Warning, can not read back from WebGL framebuffer.");
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.deleteFramebuffer(fbo);
              return false;
            }
            // restore default fbo
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            // put pixels onto an image
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var cx = canvas.getContext('2d');
            var imd = cx.createImageData(w, h);
            imd.data.set(pixels);
            cx.putImageData(imd,0,0);
            ut._HTML.images[idx].image = canvas;
            return true;
          }
        }
        if (ut._HTML.images[idx].isrt)
          return ut._HTML.images[idx].image && ut._HTML.images[idx].width==w && ut._HTML.images[idx].height==h;
        else
          return ut._HTML.images[idx].image && ut._HTML.images[idx].image.naturalWidth===w && ut._HTML.images[idx].image.naturalHeight===h;
      };
  
      ut._HTML.readyCanvasForReadback = function (idx, w, h) {
        if (!ut._HTML.ensureImageIsReadable(idx,w,h)) 
          return null;
        if (ut._HTML.images[idx].image instanceof HTMLCanvasElement) {
          // directly use canvas if the image is already a canvas (RTT case)
          return ut._HTML.images[idx].image;
        } else {
          // otherwise copy to a temp canvas
          var cvs = document.createElement('canvas');
          cvs.width = w;
          cvs.height = h;
          var cx = cvs.getContext('2d');
          var srcimg = ut._HTML.images[idx].image;
          cx.globalCompositeOperation = 'copy';
          cx.drawImage(srcimg, 0, 0, w, h);
          return cvs;
        }
      };
  
      ut._HTML.loadWebPFallback = function(url, idx) {
        function decode_base64(base64) {
          var size = base64.length;
          while (base64.charCodeAt(size - 1) == 0x3D)
            size--;
          var data = new Uint8Array(size * 3 >> 2);
          for (var c, cPrev = 0, s = 6, d = 0, b = 0; b < size; cPrev = c, s = s + 2 & 7) {
            c = base64.charCodeAt(b++);
            c = c >= 0x61 ? c - 0x47 : c >= 0x41 ? c - 0x41 : c >= 0x30 ? c + 4 : c == 0x2F ? 0x3F : 0x3E;
            if (s < 6)
              data[d++] = cPrev << 2 + s | c >> 4 - s;
          }
          return data;
        }
        if(!url)
          return false;
        if (!(typeof WebPDecoder == "object"))
          return false; // no webp fallback installed, let it fail on it's own
        if (WebPDecoder.nativeSupport)
          return false; // regular loading
        var webpCanvas;
        var webpPrefix = "data:image/webp;base64,";
        if (!url.lastIndexOf(webpPrefix, 0)) { // data url 
          webpCanvas = document.createElement("canvas");
          WebPDecoder.decode(decode_base64(url.substring(webpPrefix.length)), webpCanvas);
          webpCanvas.naturalWidth = webpCanvas.width;
          webpCanvas.naturalHeight = webpCanvas.height;
          webpCanvas.complete = true;
          ut._HTML.initImage(idx);
          ut._HTML.images[idx].image = webpCanvas;
          return true;
        }
        if (url.lastIndexOf("data:image/", 0) && url.match(/\.webp$/i)) {
          webpCanvas = document.createElement("canvas");
          webpCanvas.naturalWidth = 0;
          webpCanvas.naturalHeight = 0;
          webpCanvas.complete = false;
          ut._HTML.initImage(idx);
          ut._HTML.images[idx].image = webpCanvas;
          var webpRequest = new XMLHttpRequest();
          webpRequest.responseType = "arraybuffer";
          webpRequest.open("GET", url);
          webpRequest.onerror = function () {
            ut._HTML.images[idx].loaderror = true;
          };
          webpRequest.onload = function () {
            WebPDecoder.decode(new Uint8Array(webpRequest.response), webpCanvas);
            webpCanvas.naturalWidth = webpCanvas.width;
            webpCanvas.naturalHeight = webpCanvas.height;
            webpCanvas.complete = true;
          };
          webpRequest.send();
          return true;
        }
        return false; 
      };
  
    }

  function _js_html_loadImage(colorName, maskName) {
      colorName = colorName ? UTF8ToString(colorName) : null;
      maskName = maskName ? UTF8ToString(maskName) : null;
  
      // rewrite some special urls 
      if (colorName == "::white1x1") {
        colorName = "data:image/gif;base64,R0lGODlhAQABAIAAAP7//wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
      } else if (colorName && colorName.substring(0, 9) == "ut-asset:") {
        colorName = UT_ASSETS[colorName.substring(9)];
      }
      if (maskName && maskName.substring(0, 9) == "ut-asset:") {
        maskName = UT_ASSETS[maskName.substring(9)];
      }
  
      // grab first free index
      var idx;
      for (var i = 1; i <= ut._HTML.images.length; i++) {
        if (!ut._HTML.images[i]) {
          idx = i;
          break;
        }
      }
      ut._HTML.initImage(idx);
  
      // webp fallback if needed (extra special case)
      if (ut._HTML.loadWebPFallback(colorName, idx) )
        return idx;
  
      // start actual load
      if (colorName) {
        var imgColor = new Image();
        var isjpg = !!colorName.match(/\.jpe?g$/i);
        ut._HTML.images[idx].image = imgColor;
        ut._HTML.images[idx].hasAlpha = !isjpg;
        imgColor.onerror = function() { ut._HTML.images[idx].loaderror = true; };
        imgColor.src = colorName;
      }
  
      if (maskName) {
        var imgMask = new Image();
        ut._HTML.images[idx].mask = imgMask;
        ut._HTML.images[idx].hasAlpha = true;
        imgMask.onerror = function() { ut._HTML.images[idx].loaderror = true; };
        imgMask.src = maskName;
      }
  
      return idx; 
    }

  
  function _testBrowserCannotHandleOffsetsInUniformArrayViews(g) {
      function b(c, t) {
        var s = g.createShader(t);
        g.shaderSource(s, c);
        g.compileShader(s);
        return s;
      }
      try {
        var p = g.createProgram();
        var sv = b("attribute vec4 p;void main(){gl_Position=p;}", g.VERTEX_SHADER);
        var sf = b("precision lowp float;uniform vec4 u;void main(){gl_FragColor=u;}", g.FRAGMENT_SHADER);
        g.attachShader(p, sv);
        g.attachShader(p, sf);
        g.linkProgram(p);
        var h = new Float32Array(8);
        h[4] = 1;
        g.useProgram(p);
        var l = g.getUniformLocation(p, "u");
        g.uniform4fv(l, h.subarray(4, 8)); // Uploading a 4-vector GL uniform from last four elements of array [0,0,0,0,1,0,0,0], i.e. uploading vec4=(1,0,0,0)
        var r = !g.getUniform(p, l)[0]; // in proper WebGL we expect to read back the vector we just uploaded: (1,0,0,0). On buggy WeChat browser would instead have uploaded offset=0 of above array, i.e. vec4=(0,0,0,0)
        g.useProgram(null);
        g.deleteShader(sv);
        g.deleteShader(sf);
        g.deleteProgram(p);
        return r;
      } catch (e) {
        return false; // On failure, we assume we failed on something completely different, so behave as if the workaround is not needed.
      }
    }function _js_html_setCanvasSize(width, height, webgl) {
      console.log('setCanvasSize', width, height, webgl ? 'gl' : '2d');
      if (!width>0 || !height>0)
          throw "Bad canvas size at init.";
      var canvas = ut._HTML.canvasElement;
      if (!canvas) {
        // take possible user element
        canvas = document.getElementById("UT_CANVAS");
        if (canvas)
          console.log('Using user UT_CANVAS element.');
      } else {
        // destroy old canvas if renderer changed
        var waswebgl =
            ut._HTML.canvasMode == 'webgl2' || ut._HTML.canvasMode == 'webgl';
        if (webgl != waswebgl) {
          if (ut._HTML.freeAllGL)
            ut._HTML.freeAllGL();
          console.log('Rebuilding canvas for renderer change.');
          canvas.parentNode.removeChild(canvas);
          canvas = 0;
        }
      }
  
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.setAttribute("id", "UT_CANVAS");
        canvas.setAttribute("style", "touch-action: none;");
        canvas.setAttribute("tabindex", "1");
        if (document.body) {
          document.body.style.margin = "0px";
          document.body.style.border = "0";
          document.body.style.overflow = "hidden"; // disable scrollbars
          document.body.style.display = "block";   // no floating content on sides
          document.body.insertBefore(canvas, document.body.firstChild);
        } else {
          document.documentElement.appendChild(canvas);
        }
      }
  
      ut._HTML.canvasElement = canvas;
      
      canvas.width = width;
      canvas.height = height;
      if (webgl) {
        ut._HTML.canvasContext = canvas.getContext('webgl2'); // = null to force webgl1
        if (!ut._HTML.canvasContext) {
          ut._HTML.canvasContext = canvas.getContext('webgl');
          if (!ut._HTML.canvasContext) {
            ut._HTML.canvasContext = canvas.getContext('experimental-webgl');
            if (!ut._HTML.canvasContext) {
              console.log('WebGL context failed, falling back to canvas.');
              webgl = false;
            } else {
              console.log('WebGL context ok, but experimental.');
              ut._HTML.canvasMode = 'webgl';
            }
          } else {
            ut._HTML.canvasMode = 'webgl';
            console.log('WebGL context is webgl1.');
          }
          if (ut._HTML.canvasContext) {
            ut._HTML.browserCannotHandleOffsetsInUniformArrayViews = _testBrowserCannotHandleOffsetsInUniformArrayViews(ut._HTML.canvasContext);
          }
        } else {
          console.log('WebGL context is webgl2.');
          ut._HTML.canvasMode = 'webgl2';
        }
      }
      if (!webgl) {
        ut._HTML.canvasContext = canvas.getContext('2d');
        ut._HTML.canvasMode = 'canvas';
      } else {
        canvas.addEventListener("webglcontextlost", function(event) { event.preventDefault(); }, false);
      }
              
      window.addEventListener("focus", function(event) { ut._HTML.focus = true; } );
      window.addEventListener("blur", function(event) { ut._HTML.focus = false; } );
      
      canvas.focus();
      return webgl;
    }

  function _js_inputGetCanvasLost() {
          // need to reset all input state in case the canvas element changed and re-init input
          var inp = ut._HTML.input;        
          var canvas = ut._HTML.canvasElement;    
          return canvas != inp.canvas; 
      }

  function _js_inputGetFocusLost() {
          var inp = ut._HTML.input;
          // need to reset all input state in that case
          if ( inp.focusLost ) {
              inp.focusLost = false; 
              return true; 
          }
          return false;
      }

  function _js_inputGetKeyStream(maxLen,destPtr) {
          var inp = ut._HTML.input;
          return inp.getStream(inp.keyStream,maxLen,destPtr);            
      }

  function _js_inputGetMouseStream(maxLen,destPtr) {
          var inp = ut._HTML.input;
          return inp.getStream(inp.mouseStream,maxLen,destPtr);
      }

  function _js_inputGetTouchStream(maxLen,destPtr) {
          var inp = ut._HTML.input;
          return inp.getStream(inp.touchStream,maxLen,destPtr);        
      }

  function _js_inputInit() {
          ut._HTML = ut._HTML || {};
          ut._HTML.input = {}; // reset input object, reinit on canvas change
          var inp = ut._HTML.input; 
          var canvas = ut._HTML.canvasElement;
          
          if (!canvas) 
              return false;
              
          inp.getStream = function(stream,maxLen,destPtr) {
              destPtr>>=2;
              var l = stream.length;
              if ( l>maxLen ) l = maxLen;
              for ( var i=0; i<l; i++ )
                  HEAP32[destPtr+i] = stream[i];
              return l;
          };
              
          inp.mouseEventFn = function(ev) {
              var inp = ut._HTML.input;
              var eventType;
              var buttons = 0;
              if (ev.type == "mouseup") { eventType = 0; buttons = ev.button; }
              else if (ev.type == "mousedown") { eventType = 1; buttons = ev.button; }
              else if (ev.type == "mousemove") { eventType = 2; }
              else return;
              var rect = inp.canvas.getBoundingClientRect();
              var x = ev.pageX - rect.left;
              var y = rect.bottom - 1 - ev.pageY; // (rect.bottom - rect.top) - 1 - (ev.pageY - rect.top);
              inp.mouseStream.push(eventType|0);
              inp.mouseStream.push(buttons|0);
              inp.mouseStream.push(x|0);
              inp.mouseStream.push(y|0);
              ev.preventDefault(); 
              ev.stopPropagation();
          };
          
          inp.touchEventFn = function(ev) {
              var inp = ut._HTML.input;
              var eventType, x, y, touch, touches = ev.changedTouches;
              var buttons = 0;
              var eventType;
              if (ev.type == "touchstart") eventType = 1;
              else if (ev.type == "touchend") eventType = 0;
              else if (ev.type == "touchcanceled") eventType = 3;
              else eventType = 2;
              var rect = inp.canvas.getBoundingClientRect();
              for (var i = 0; i < touches.length; ++i) {
                  var t = touches[i];
                  var x = t.pageX - rect.left;
                  var y = rect.bottom - 1 - t.pageY; // (rect.bottom - rect.top) - 1 - (t.pageY - rect.top);
                  inp.touchStream.push(eventType|0);
                  inp.touchStream.push(t.identifier|0);
                  inp.touchStream.push(x|0);
                  inp.touchStream.push(y|0);
              }
              ev.preventDefault();
              ev.stopPropagation();
          };       
  
          inp.keyEventFn = function(ev) {
              var eventType;
              if (ev.type == "keydown") eventType = 1;
              else if (ev.type == "keyup") eventType = 0;
              else return;
              inp.keyStream.push(eventType|0);
              inp.keyStream.push(ev.keyCode|0);
          };        
  
          inp.clickEventFn = function() {
              // ensures we can regain focus if focus is lost
              this.focus(); 
          };        
  
          inp.focusoutEventFn = function() {
              var inp = ut._HTML.input;
              inp.focusLost = true;
          };
          
          inp.mouseStream = [];
          inp.keyStream = [];  
          inp.touchStream = [];
          inp.canvas = canvas; 
          inp.focusLost = false;
          
          // @TODO: handle multitouch
          // Pointer events get delivered on Android Chrome with pageX/pageY
          // in a coordinate system that I can't figure out.  So don't use
          // them at all.
          //events["pointerdown"] = events["pointerup"] = events["pointermove"] = html.pointerEventFn;
          var events = {}
          events["keydown"] = inp.keyEventFn;
          events["keyup"] = inp.keyEventFn;        
          events["touchstart"] = events["touchend"] = events["touchmove"] = events["touchcancel"] = inp.touchEventFn;
          events["mousedown"] = events["mouseup"] = events["mousemove"] = inp.mouseEventFn;
          events["focusout"] = inp.focusoutEventFn;
          events["click"] = inp.clickEventFn;
  
          for (var ev in events)
              canvas.addEventListener(ev, events[ev]);
                 
          return true;   
      }

  function _js_inputResetStreams(maxLen,destPtr) {
          var inp = ut._HTML.input;
          inp.mouseStream.length = 0;
          inp.keyStream.length = 0;
          inp.touchStream.length = 0;
      }

  function _js_measureText(text, family, size, weight, italic, outWidth, outHeight) {
        text = UTF8ToString(text);
        family = UTF8ToString(family);
        var useMeasureText = false;
        if (useMeasureText) {
            // measureText() gives worthless old DOMTextMetrics on all but the most recent browsers,
            // and even then not in some cases.  The worthless one has only a width, no height.
            if (!ut._HTML.canvasTextMeasureContext) {
                ut._HTML.canvasTextMeasureCanvas = document.createElement("canvas");
                ut._HTML.canvasTextMeasureContext = ut._HTML.canvasTextMeasureCanvas.getContext("2d");
            }
  
            var context = ut._HTML.canvasTextMeasureContext;
            context.font = weight + ' ' + (italic ? 'italic ' : '') + size + "px" + ' ' + family;
            context.fillStyle = "black";
            context.textAlign = "left";
            context.textBaseline = "bottom";
  
            var metrics = context.measureText(text);
            HEAPF32[outWidth>>2] = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            HEAPF32[outHeight>>2] = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        } else {
            // This works everywhere, but is not sufficient to figure out the black box origin
            // of the text.
            var div = document.createElement("div");
            div.style.position = "absolute";
            div.style.visibility = "hidden";
            div.style.fontFamily = family;
            div.style.fontWeight = weight;
            // UTINY-1723: Getting the text measurements for small font size (<5) is inaccurate (always same width (12px) for example in Firefox).
            // Let's compute it for a font 20 times bigger and get w/h 20 times smaller
            var mult = 1;
            if (size < 5)
              mult = 20;
            div.style.fontSize = size * mult + "px";
            div.style.fontStyle = italic ? "italic" : "normal";
            div.style.textAlign = "left";
            div.style.verticalAlign = "bottom";
            div.style.color = "black";
            //Remove any white spaces when computing the bbox. We will consider them separately below
            var textWithWS = text.replace(/\s/g, "");
            div.innerText = textWithWS;
            document.body.appendChild(div);
            var rect = div.getBoundingClientRect();
            document.body.removeChild(div);
  
            //Previous bbox computed reduces consecutive white spaces to one white space. So we need here to compute the width of all white spaces separately
            var newCanvas = document.createElement("canvas");
            var ct = newCanvas.getContext("2d");
            ct.font = weight + ' ' + (italic ? 'italic ' : '') + size * mult + "px" + ' ' + family;
            ct.textAlign = "left";
            ct.textBaseline = "bottom";
            var wsWidth = ct.measureText(" ").width;
            var wsCount = text.split(" ").length - 1;
            var tabWidth = ct.measureText("\t").width;
            var tabCount = text.split("\t").length - 1;
  
            var resW = (rect.width + wsWidth * wsCount + tabCount * tabWidth) / mult;
            var resH = rect.height / mult;
            
            HEAPF32[outWidth >> 2] = (rect.width + wsWidth * wsCount + tabCount * tabWidth) / mult;
            HEAPF32[outHeight >> 2] = rect.height / mult;
        }
      }

  
  function utf16_to_js_string(ptr) {
      var str = '';
      ptr >>= 1;
      while (1) {
        var codeUnit = HEAP16[ptr++];
        if (!codeUnit) return str;
        str += String.fromCharCode(codeUnit);
      }
    }function _js_renderTextTo2DCanvas(text, family, size, weight, italic, r, g, b, a, width, height) {
          text = utf16_to_js_string(text);
          var font = size + 'pt' + ' ' + utf16_to_js_string(family);
          
          var context = ut._HTML.canvasContext;
          context.font = weight + ' ' + (italic ? 'italic ' : '') + font;
          context.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
          context.globalAlpha = a / 255;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(text, width/2, height/2);
      }

  function _js_texImage2D_from_html_image(htmlImageId) {
      GLctx['texImage2D'](0x0DE1/*GL_TEXTURE_2D*/, 0, 0x1908/*GL_RGBA*/, 0x1908/*GL_RGBA*/, 0x1401/*GL_UNSIGNED_BYTE*/, ut._HTML.images[htmlImageId].image);
    }

  function _js_texImage2D_from_html_text(text, family, fontSize, weight, italic, labelWidth, labelHeight) {
  
      var font = fontSize.toString() + 'px ' + utf16_to_js_string(family);
      var newFont = weight.toString() + ' ' + (italic ? 'italic ' : '') + font;
  
      // Update the canvas and texture
      var textCanvas = window.document.createElement('canvas');
      textCanvas.width = labelWidth;
      textCanvas.height = labelHeight;
  
      var context = textCanvas.getContext("2d");
      context.fillStyle = 'white';
      context.font = newFont;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(utf16_to_js_string(text), labelWidth / 2, labelHeight / 2);
  
      GLctx['texImage2D'](0x0DE1/*GL_TEXTURE_2D*/, 0, 0x1908/*GL_RGBA*/, 0x1908/*GL_RGBA*/, 0x1401/*GL_UNSIGNED_BYTE*/, textCanvas);
    }

  function _llvm_trap() {
      abort('trap!');
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

   

  
  function ___setErrNo(value) {
      return 0;
    }
  
  function _emscripten_get_heap_size() {
      return TOTAL_MEMORY;
    }
  
  function _emscripten_resize_heap(requestedSize) {
      return false; // malloc will report failure
    } 
Fetch.staticInit();;
var GLctx; GL.init();
var ut;;
// ASM_LIBRARY EXTERN PRIMITIVES: Int8Array,Int32Array

var debug_table_fi = [0,'_Enumerator_get_Current_mF1A4650179F6D4906E6D329C37DA56B17AA5BA89_AdjustorThunk','_Enumerator_get_Current_m897862F8EDC4BCE5C9957AAC9889874F3BA1C668_AdjustorThunk',0];
var debug_table_i = [0,'_Program_MainLoop_m282954213F14E9D3B47DF71802757BBFC4DDBB46','_HTMLWindowSystem_ManagedRAFCallback_m062A5883152184FA83E0F07F33A2D172B3586333','_ReversePInvokeWrapper_HTMLWindowSystem_ManagedRAFCallback_m062A5883152184FA83E0F07F33A2D172B3586333','_GC_never_stop_func','_GC_timeout_stop_func',0,0];
var debug_table_idi = [0,'__ZL4tickdPv'];
var debug_table_ii = [0,'_Object_GetHashCode_mE75D1181FA49099A73263AFA2265906320FBFFDC','_Object_ToString_m14EC9F88B142CD234DA976F38AC90922AF1CEC39','_Guid_GetHashCode_mA862A7F9AFABAC96BD4415C439C15DC5922E6F6F_AdjustorThunk','_Guid_ToString_mA0282CD28043215F70FCAAD340145088B1C25FF9_AdjustorThunk','_ValueType_GetHashCode_mACF6C023D7B744E853CA2C94D9B799E21216F8B4','_IntPtr_GetHashCode_m9A4B9D4D1CE1FF9200C549C84B8324853543845B_AdjustorThunk','_String_GetHashCode_mBE6DC451E20B85987B93265341B3EA2735498F3B','_Enum_GetHashCode_m700E2A5F6FEA2566169CE217E90E9C0E991ABA81','_float2_GetHashCode_mAE323C3527D734A88A9FE34291F8A1F4C93B9B99_AdjustorThunk','_float2_ToString_m8752A7DEFB1072B01E0C787CCAD90B327559235E_AdjustorThunk','_float3_GetHashCode_m83BFF402355070EDC505C31B3472E999059D4E05_AdjustorThunk','_float3_ToString_m935D13C9ABDB09D7CB0535F92B98C52373E635A5_AdjustorThunk','_float4_GetHashCode_m2CDCEBDE358FBC59C988051649074C48C83C5074_AdjustorThunk','_float4_ToString_m1F4919F7A7C302D450C59E7D42571F867492504D_AdjustorThunk','_float4x4_GetHashCode_m37842D27240A8E43D942F28D78E3AD09ECDDCB66_AdjustorThunk','_float4x4_ToString_mA71FA988896F3978FBE959FC135DFC14A75AE2B7_AdjustorThunk','_quaternion_GetHashCode_m43A87D2EC72F8B5CD17D7648FC80BA7A3A73290E_AdjustorThunk','_quaternion_ToString_mFE6083AC274988D47ACD636480C5FEE870069D2A_AdjustorThunk','_uint2_GetHashCode_m99BCEE817BD13D53EB6C93C9C386548A90665A95_AdjustorThunk','_uint2_ToString_mC68A07294FE1576E914B31E4AD5A3F0B80C5A9DA_AdjustorThunk','_UInt32_GetHashCode_m1B91DF511AC1D7DFC78E6F48B0390D3954A28C50_AdjustorThunk','_UInt32_ToString_m3AB9F9E4CAB35FB1827389674581C0D5B69CA200_AdjustorThunk','_uint3_GetHashCode_mAA8E894E36A77D94CD4AD182D1A3551F3F28AF56_AdjustorThunk','_uint3_ToString_m22FF8A0C1C7AE35C0E86F01929565D4F208C8B51_AdjustorThunk','_uint4_GetHashCode_mF96BEEDF957F2D18A1EF930730A3EE28747FFF18_AdjustorThunk','_uint4_ToString_mC0193431D2977DB806DEC7252515F804F450D930_AdjustorThunk','_Int32_GetHashCode_m1D9FEC8879ADE18E13A011D5A8CCB5D87E7BDA77_AdjustorThunk','_Int32_ToString_m0847A50454BC800B9F3D6F8644D775D6A5632ADF_AdjustorThunk','_MainLoopDelegate_Invoke_mE4A0FDCBE5EF63EE025714DE464A295DCF971163','_AssetReference_GetHashCode_mFDA1BA1099BD05B34B2982A51C8C2C30BE21AE34_AdjustorThunk','_Entity_GetHashCode_m7A45E0F78524A73C475F399AB0FDBCE3A49FA7A5_AdjustorThunk','_Entity_ToString_m5FECA655263AC561E14B90D3A215C6CBF193511C_AdjustorThunk','_EntityGuid_GetHashCode_m3A49427F2B48761C38F12C4C19973816381C575E_AdjustorThunk','_EntityGuid_ToString_mC0A09A0DF85109DDDD1008C86C60901B21485EAD_AdjustorThunk','_SceneTag_GetHashCode_m151E613756E364B83A3E93ED255B6941EDC1AA99_AdjustorThunk','_SceneTag_ToString_m5A9E22C14FB1C882BF7B8C8FCE06C76A47C0862C_AdjustorThunk','_SceneSection_GetHashCode_mA8D67A844B2B2CB5EE6BFA13C39FEF78CA5407F6_AdjustorThunk','_SceneGuid_GetHashCode_m2A0F17D143657B4BF8661ADA5ABA634A3DA51250_AdjustorThunk','_MakeEntryShape_GetRendererComponent_mAC54C3A61B2AE168C7FC1AFA179796AF7BE82E72','_MakeEntryShape_DoNotClip_mDAAA9BC737F2A4EFE92DE35E57EA59DBAB9DDF50','_PointerID_GetHashCode_m44C09972E7E92F8C475E525DE0E2192B4E80316F_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0EA1212F5952217677FB9138F28BF5332F1654FE','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m2E602191B920C8935EDA2B51B4092EFDA8055992','_MakeEntryText_GetRendererComponent_mE48352FD0FB9A6AB130A0027A3A81D7BE2458CCA','_MakeEntryText_DoNotClip_mCA68454D89A4CCEC8151BD40C698FBD16179D660','_MakeEntrySprite_GetRendererComponent_m4F6094B2EACCDD6711B38C7653E27F7952179D88','_MakeEntrySprite_DoNotClip_mAD198708FC5E90BB602DBD263F34A43487F6BA08','_Scene_GetHashCode_mEC5E823F45635B323E8B44E38D43930E9A240720_AdjustorThunk','_World_ToString_mB51E81D7CF113A1580D3DC40A4440ED789916181','_Color_GetHashCode_m84C20CF5C0F25B2CFA63B3831683008378BFA7F3_AdjustorThunk','_MakeEntrySortingGroup_GetRendererComponent_m5EB6AC675C32E9389287E1A6C1FA5B2EB599CDAC','_MakeEntrySortingGroup_DoNotClip_m865BCCACAD4675D6EAB683A8E320A0567E168B37','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m4232D5728038E25A82A2864F758CE5EDD0AA8A07','_ComponentTypeInArchetype_GetHashCode_m0B1283A32152AB75FBE6DA40242390CC4F02BC68_AdjustorThunk','_ComponentTypeInArchetype_ToString_m2F0D735CC5ADDAA04A3617EEB58EF5930C008EEA_AdjustorThunk','_ArchetypeChunk_GetHashCode_m83F963177B8194E8974839669C984796B0ED64CC_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m700AE89140EA61779E627C74BBF49BB2F8777D06','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB1E1BD875D9EB349F4925DEDE584079492B710B8','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m2CE492C839356DF44518859856CE3BE184F60836','_ComponentType_GetHashCode_m16D6E48F1F0F1C3DA6FB4BD39E37A0DD64FA2331_AdjustorThunk','_ComponentType_ToString_mBB6865B4A8B2BA65A1781D84513501EFED67E8C0_AdjustorThunk','_EntityArchetype_GetHashCode_mDF7D476F5077CC3BF2ABDECD6B984AEDEA3621CA_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m611B041169CB7751903D3E64651D435317C15F0F','_UInt64_GetHashCode_m4D06BFA310B32E43E22558EDEC8769559ADD68B5_AdjustorThunk','_UInt64_ToString_m91B9CA62CE092ED743E74E29B232748AF9B4C3A3_AdjustorThunk','_Boolean_ToString_mB9147B756B8C610B64C3F78CED0D9341C1941FA7_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m00BF019A7F79AD73545DE4C826D2D409B287221C','_NativeString512_GetHashCode_m022077C3C736FB2DE6990F18FCC3612C345F69DB_AdjustorThunk','_NativeString512_ToString_mDAF3B3E0F0425CF96F7F63225283DDF7D10512F8_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8FE16AD757A9286225FA1B40A38A993F27EAB8C8','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m9E0F8FF75681BAD09D6D026FC11B4853C86E6658','_Char_ToString_m0AD9865C4FBAAD435863431AE96D111232D043E2_AdjustorThunk','_Enumerator_get_Current_mC6ABC79D914E30843E5281248A7B59B3799661CB_AdjustorThunk','_Enumerator_MoveNext_m54B9D0E883BEF5D5496D81E9CB36B88DB36C1070_AdjustorThunk','_Enumerator_get_Current_m1ECEC59809D0B9EEEC4D7DE98B3A6B057BB6D6F0_AdjustorThunk','_Enumerator_MoveNext_m3A7988C109121F246601ABBF6FE1BEEE663A8437_AdjustorThunk','_Enumerator_get_Current_m6614170FE1171F7E1D490775C5F219A0B428EC68_AdjustorThunk','_Enumerator_MoveNext_mD3FFD4BD996B0F0A7A253F276B60A763E62FCB87_AdjustorThunk','_Enumerator_get_Current_m75695AC77D9CDB17A58C9BD84287F87B9045D678_AdjustorThunk','_Enumerator_MoveNext_m865652C1029399686CC98545F5BCC33A5C883E7F_AdjustorThunk','_Enumerator_MoveNext_m312833D122E654D9A39B769358F938D326B251E5_AdjustorThunk','_Enumerator_MoveNext_m103664CCA6B43723A09D7377112016323C82D56B_AdjustorThunk','_Enumerator_get_Current_mD43EF163773453F38EC03CACD91C76CE087B17F1_AdjustorThunk','_Enumerator_MoveNext_m2776C817B5249753A68B859E57B3AD4BEE5F732A_AdjustorThunk','_Enumerator_get_Current_m8059C6ED593CAC563BFAE26BC7727174FB1D81AC_AdjustorThunk','_Enumerator_MoveNext_m537CF256BC434693FD894BDE5484D26B9306CEFB_AdjustorThunk','_Enumerator_get_Current_m79BA9181BECE1D316D7737C5787B2EC5B986F385_AdjustorThunk','_Enumerator_MoveNext_m7BBF50B7AEA18057653C90AAA4C6679FB0C2D94E_AdjustorThunk','_Enumerator_get_Current_m9AD0448730AE2AE8B8505D356CDD93FB1C66CCEE_AdjustorThunk','_Enumerator_MoveNext_m9C136F3AB6CD9B9713E6C2D8CCCA84F0B2E11F49_AdjustorThunk','_Enumerator_MoveNext_m527469970A6743F646CCAED784CE86C22B4FED2F_AdjustorThunk','_NativeArray_1_GetHashCode_mD0ACFBD114657D7CCB6358DFCC401DE1B710F986_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m3BCF6104439F42A045F5E9FC3DBAA2EAB6D947C9_AdjustorThunk','_Enumerator_MoveNext_m3EC46A6A54D89242282A76FA202269B274683774_AdjustorThunk','_NativeArray_1_GetHashCode_m383F1CFF267617E1816E5D2E719FDF422E14B41E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8C5E83EE19E71BC81A771038C69CBE29343872A9_AdjustorThunk','_Enumerator_MoveNext_m4EC96CF46F17328FE2F1A7140A5E658683DE740C_AdjustorThunk','_NativeArray_1_GetHashCode_mD44A9B3F33A52663EFB4A8AB464BBE3B0EE6D006_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mF476597566D6EAA53B9C65ABE23EE3C78498B29E_AdjustorThunk','_Enumerator_get_Current_mAD1D6A047F7E0A08CC02176ADD6F19FB72A60360_AdjustorThunk','_Enumerator_MoveNext_m670CF42F8376CB2F1ED267BF192E34166F5C4A77_AdjustorThunk','_NativeArray_1_GetHashCode_mF43BFB59B16019171E1BCFB7F4774F134918B8C8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m487B7ED111AF1BC767A3D937F5C74C4C707BE95A_AdjustorThunk','_Enumerator_get_Current_mDF8C7CB079005C8869B49AB631601F72924E5028_AdjustorThunk','_Enumerator_MoveNext_mFF1555CA98711ECD46649538E3CAEE4E07B5D103_AdjustorThunk','_NativeArray_1_GetHashCode_m7F551CD74925F289E14A9D4A488B80B5FFA6BEFF_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mD243469954012C4FE03FBF86E0BBBD0F78AB2601_AdjustorThunk','_Enumerator_MoveNext_mD4E1D33D83BA1497CFAD18A2CFD66ECD2D003135_AdjustorThunk','_NativeArray_1_GetHashCode_mB4458AADC76D94F31AAE30E12848F83A6C66B6EF_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB2F99E93B69580E4D8ECA0352148479C34DC5926_AdjustorThunk','_Enumerator_MoveNext_mA9E156C5D2BE70E948235A6D8F2C64334E759EB6_AdjustorThunk','_NativeArray_1_GetHashCode_mC68289D3A30122ABEDBD25E7EE9D0C61B11F565F_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m9602E0C9DC76E6CC9BC1A6E49B5E7AE5A9831662_AdjustorThunk','_Enumerator_MoveNext_mEC082CB5A4C7AE47B74BAC7DAF8102AB70682EBB_AdjustorThunk','_NativeArray_1_GetHashCode_mA161B297DC3D569C2D937BC2782B1B1E23C0CB45_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7734C6F9EFB677339F3950E734C9C51C91EA12ED_AdjustorThunk','_Enumerator_MoveNext_m778F3D02ACB1E904661A22834A029A75FCC7B8A0_AdjustorThunk','_NativeArray_1_GetHashCode_mE2DF2BE090D63B47193A78E85E8323E318683926_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m681502D8F769F1F62DF6CC3C5CC1B15DD96DD2A5_AdjustorThunk','_Enumerator_MoveNext_m3394FDABFA27D29270B1D7BB8CAB842A2909B6A9_AdjustorThunk','_NativeArray_1_GetHashCode_m3843C5517B73BD21969B059D09720968703E28BB_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB72D19668A139C1F44C39365E63FEE70E1286D40_AdjustorThunk','_Enumerator_get_Current_m2B47245DB3003B76DF4958188BE5CDD2463B4738_AdjustorThunk','_Enumerator_MoveNext_m3B7A140694D8726DC2D4DFEF6AB6B536F193A45D_AdjustorThunk','_NativeArray_1_GetHashCode_m9297812A847AED45844A001127D12A74E0152FBA_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCA824E31A32B692EBBB01FF6E6BDEDB287D943FC_AdjustorThunk','_Enumerator_MoveNext_mB2BD7ABD228D90C47626BD751926905FBCC15E72_AdjustorThunk','_NativeArray_1_GetHashCode_mE09817230BBF4E6F70CC42AB572BB289AE2A3122_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5DB74A9A2D0001EAA346B834DD36A5F7E3A9F415_AdjustorThunk','_Enumerator_MoveNext_m37B779ED3E2E6EA6B7F2F76BC15267728BFBD2D2_AdjustorThunk','_NativeArray_1_GetHashCode_mF77F294D1A412E2B8CD9358AA6535CD5A5D67BB3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA68B8ACD22836B0DCB481FBD2C3C9D69AC6825C3_AdjustorThunk','_Enumerator_MoveNext_m54C946FBF011C3F026AA1D9BBCD9C559CAA601AA_AdjustorThunk','_NativeArray_1_GetHashCode_m1796FE41BF5512DA864E73BCDD3D728BC0DF13AB_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7E2A2AAB36223A9B36A5044C691D5F992910CCE1_AdjustorThunk','_Enumerator_MoveNext_m506BA2EF90F3E94DFAE8B329B095F14E5242B9CF_AdjustorThunk','_NativeArray_1_GetHashCode_m9476E2ED1A9514519700C83933F14D240D37B011_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m4D5DBEC1A81A5155B1AAE8DBF4F26B347FB3CC9E_AdjustorThunk','_Enumerator_MoveNext_m4F8CB5671CC8FC042E55379583B67F02CB159BD5_AdjustorThunk','_NativeArray_1_GetHashCode_m569976D2ABD9AC72F1BA6DDACAD998C520EBA53E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5B36182E83DF439797AA044CBE7C204682344C78_AdjustorThunk','_Enumerator_MoveNext_m450F7DB705C04B10BAF4B829A06C9008904841C9_AdjustorThunk','_NativeArray_1_GetHashCode_m66261BB3D92BBB81568F0E2FF797D39E92E526D9_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m35EAC12C7134FD8141C01E8FFC74FAF61F928439_AdjustorThunk','_Enumerator_MoveNext_m093D45DE080BF6CD9FCD5A8B0DA28E10F87B7A92_AdjustorThunk','_NativeArray_1_GetHashCode_mB07EA6795A7FBA0242C7F031652AA1A2EAD2EF88_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5DF0C982062C972965D52F726B4591680A18389E_AdjustorThunk','_Enumerator_get_Current_m662DF0B6737DFF8E789A55EC9B0BF3DBFAC4B4C2_AdjustorThunk','_Enumerator_MoveNext_m0C37279B78A263BB4DF03ADDE8159ADB07AB8B27_AdjustorThunk','_NativeArray_1_GetHashCode_m55FF4CB89B1695D8F3CCBABF5BC45028A72DE65C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mF7B0DFC2FA0789CBC96A3D9859BA6A8610B9E588_AdjustorThunk','_Enumerator_MoveNext_mED1BB116F345B5B357DB2879E148848C913BD908_AdjustorThunk','_NativeArray_1_GetHashCode_m5E17F784923682A1CF2F9ED0B1FA9F1B10BCB33A_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA9960AD928747D86BC483094249D19A0969E697B_AdjustorThunk','_Enumerator_get_Current_m4DBCE381F7AF3EFC95CFA2D668F9AFC702E3787C_AdjustorThunk','_Enumerator_MoveNext_m4F9E9070B62072BAA51616CD4A7A4F03D7F739FD_AdjustorThunk','_NativeArray_1_GetHashCode_m970B883CC9D910CF3B64193AFB6F8273707F29D7_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m3858FC2C3C741312EB0A45017FC6027E24F023D7_AdjustorThunk','_Enumerator_get_Current_m013D741811772B228300217CCDF5703D6A952871_AdjustorThunk','_Enumerator_MoveNext_mA30C630EB37C82E85DDEDD9F0AFA69A6A5957A73_AdjustorThunk','_NativeArray_1_GetHashCode_m6111E3B774E810C640494D0C22E7ADE2240C550D_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE36D1BD21F02B1B1C04CF18F5779D05DB3573B2B_AdjustorThunk','_Enumerator_get_Current_m57DD57AC10CA6CE7700EDE23C043B03DB6611CF3_AdjustorThunk','_Enumerator_MoveNext_m8DBEE91743A20DC3E198F415163F8AE70BEBF4A5_AdjustorThunk','_NativeArray_1_GetHashCode_mE2134BDABFC784650117060CA560F5C7641698FB_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE537A3D0A7CE4F9F6A32CD7ABB14FA6C37BF3C75_AdjustorThunk','_Enumerator_MoveNext_m77CACB4B1D4BB5CAB4A849FBF4AFA6F8E10DD7E3_AdjustorThunk','_NativeArray_1_GetHashCode_m6211E1EFB08ADA6362481CFB83DA0146DBC17690_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA517A9BBE2CD1BA44DC39FD1F12AC8072FDE4D4E_AdjustorThunk','_Enumerator_get_Current_mE19D343428B1B8FB01E897C4C6265DED998EA8F1_AdjustorThunk','_Enumerator_MoveNext_mD966B1F627F42A038E185344564CB8522F5CAC3A_AdjustorThunk','_NativeArray_1_GetHashCode_m567F96E260202F35E73591AF0216577FB179596C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mBC4F757C97F8BB849E84DEFC912BC0A1BE76E3A7_AdjustorThunk','_Enumerator_get_Current_m8D6CF041E2543A7E391C614503F1730B84ECABA9_AdjustorThunk','_Enumerator_MoveNext_m6EABE47AD99AB06812BE078ACCD9CDA676C092BC_AdjustorThunk','_NativeArray_1_GetHashCode_m5C70E82A0DCC2F76C6682585FC0FF65420F8ED17_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCA5C2C08197606B93E011BC71B88D984E06DFCBB_AdjustorThunk','_Enumerator_MoveNext_mD95524C699AFF5D8CD88118FFC5CCC1C89D99EFF_AdjustorThunk','_NativeArray_1_GetHashCode_m7A2B5FA2A049B999D65AA409281C78815CE3BD6B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m65C7991F23C8C1DB1284BC73533BF62EF648D892_AdjustorThunk','_Enumerator_MoveNext_m215CF697B06C4DCED17E602BB0044598C0C731B5_AdjustorThunk','_NativeArray_1_GetHashCode_mC3129F5D5B907A35D46E746683EF8332D21C8AF2_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m04B7D97036A8918DBD4561AE3BF0E9580FC6ECF2_AdjustorThunk','_Enumerator_MoveNext_mBAF69E15F7695086F1513156436D9ADD7C8B254B_AdjustorThunk','_NativeArray_1_GetHashCode_mE8AE17CBDC6022F19953758FC09854841D1D3D07_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m35E53C453BB9820A758FE425679DFCAB95915A04_AdjustorThunk','_Enumerator_MoveNext_m8FC2CB476198BADBB914753088F5E269B9BAC44D_AdjustorThunk','_NativeArray_1_GetHashCode_m36DF40F9ADE5E2F844F7C0CEA10EB0381A650073_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8A72B4DB1347FFBBE843455D78411BAA6FD7AE00_AdjustorThunk','_Enumerator_get_Current_m7932861E655AA558358E6B7DCBAA72BB7868A2FD_AdjustorThunk','_Enumerator_MoveNext_m21B5AEB6794E0F39A0A150C2775703E931E47A72_AdjustorThunk','_NativeArray_1_GetHashCode_mA8CDDED367C30AC2E57633BF349A9257FF5AD166_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m69A98882F67325E238507F38D4C795D843FCE759_AdjustorThunk','_Enumerator_get_Current_mAA1EBE101F11057C025498076DD6BCF1A2F59C37_AdjustorThunk','_Enumerator_MoveNext_mB3CFCFBF11084A9FC9460236C62F20F805B29D80_AdjustorThunk','_NativeArray_1_GetHashCode_mE5F7B7DE653B47528279CE9E4521DB68F102EDA0_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mAB6301849C9888290B32A7DDD4A720EF4BFB985D_AdjustorThunk','_Enumerator_get_Current_m1AA46596499AB2ED7EB924BFC288B0085187CD24_AdjustorThunk','_Enumerator_MoveNext_m72FA6B029B45EDA449B2DA84873D74E83FC5295C_AdjustorThunk','_NativeArray_1_GetHashCode_m8C38F0B8A2F71300A74B31BD8EC5D4DD4A570722_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mF8CBBE39CD2470022A15B51245333E5CA7757B68_AdjustorThunk','_Enumerator_get_Current_mE4819553EDE25C0885052B093086F5D5CB87882D_AdjustorThunk','_Enumerator_MoveNext_m50A81F09CCD6DE4449E02DF64BDA9CF61E809569_AdjustorThunk','_NativeArray_1_GetHashCode_m4AB8FB978A1371B392D9795F5AA0B78412ACDE2E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mED0C767029AB644BFB7B57A5978DCF3A4EAEDFD7_AdjustorThunk','_Enumerator_MoveNext_m807BF17890364726549FA89D44960F3BF02981FA_AdjustorThunk','_NativeArray_1_GetHashCode_m2775BBE610B77936FF761018FE19D33C1DA24C68_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m54225932ED973BA89E0F85C6F4041207D4A4EC07_AdjustorThunk','_Enumerator_MoveNext_m349E9C6CFA51E613AA55286CF4DF5B236B19F01F_AdjustorThunk','_NativeArray_1_GetHashCode_m18B3BA02DC74069CF69AE893707BBB7CADFCF3BA_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m956DE4C9EC156CB93EF4AAA4F13CC1A9810533E4_AdjustorThunk','_Enumerator_MoveNext_mE808758574D6CD974F59FBA440E8F3EB45C2EFED_AdjustorThunk','_NativeArray_1_GetHashCode_m333634BB79CF5561EC6C8DCF0825C692C57896B0_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEA61B1E803A560BBD4DE957F00885F0689DF75A0_AdjustorThunk','_Enumerator_MoveNext_m9BAE163493219240981AE9B1B17694EF7CD14E72_AdjustorThunk','_NativeArray_1_GetHashCode_m6E4613284596172EEC67781259DA379838A2B9F7_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0F8F216CEDE7FC2905FAE4EC9CF96B2B9A04C2DC_AdjustorThunk','_Enumerator_MoveNext_mECE076A6D044DD821F500D86A6BE8AA32D36A4D7_AdjustorThunk','_NativeArray_1_GetHashCode_m65E4CF42B8C3BE498C3A1F404A0C02EA458622D7_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCE084FEE496214E718A3507B4D673DFF20091129_AdjustorThunk','_Enumerator_MoveNext_mD16D98EEECBD089C2B5621C1178FC9E94B7ED0DF_AdjustorThunk','_NativeArray_1_GetHashCode_mA467F4FFA12A5DEF5469A8581492431A4F2701FA_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m00164C14013D4B5F68E115E6C828E5C6693E28CA_AdjustorThunk','_Enumerator_MoveNext_mD3099225151AFF2F052068989DAD01D19F12AF74_AdjustorThunk','_NativeArray_1_GetHashCode_m042A7EB92E9E8C18EA5AE92FE8F9AC114F9BFE19_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE3B38FB7ABAF241F0AABBB2F655DEA4C702B6A30_AdjustorThunk','_Enumerator_MoveNext_m49994EC167BFD725E7BF0F93D082B04C69772300_AdjustorThunk','_NativeArray_1_GetHashCode_m129048297CBD258F0BDE2F7519AAFBDD51C707A0_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB2D763324F409FBC95FD3515A696E912461D97EA_AdjustorThunk','_Enumerator_MoveNext_m2E3C8283D213973867A767E538315859E3749C8A_AdjustorThunk','_NativeArray_1_GetHashCode_m0A7F886695996164DD5E7E1AFE46075680368F56_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0533221ED1A72900FF817B1CD75B57592800B68A_AdjustorThunk','_Enumerator_MoveNext_m0B5970F9E0B09C3EC1BD5163B35C5540A7779034_AdjustorThunk','_NativeArray_1_GetHashCode_mF493094D8FC21C54706C29BFD89756CC78237AF8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mD59E8A504EACE3319198F4C49C1DFA3DF54AFE9E_AdjustorThunk','_Enumerator_MoveNext_m451D89CD407AF0FED36141E97E8D9C88429DF8DC_AdjustorThunk','_NativeArray_1_GetHashCode_mF5CBDBD4EF5330EE77226873C174F6E81F41FFFF_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA2C086EA98C05216490D9964EF3684C3A2C1B024_AdjustorThunk','_Enumerator_MoveNext_mEDB8EF5DAF162DE9860429C1D1FBB1764447FB89_AdjustorThunk','_NativeArray_1_GetHashCode_m511F8E7E1BE2E6A587843B2DE09A7B5094D72A22_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mABF05F910ED1A4BAA3CA3907250EE12CDA469E2B_AdjustorThunk','_Enumerator_MoveNext_m9626CA0CF76A504E150495D3FB9FDDCA98A07D34_AdjustorThunk','_NativeArray_1_GetHashCode_m8C46C392FD785F3CF449E462A507B9F0FCA2B97E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m2F3AADB187A398CE74E7B52B3CAF8F5AA7F8473C_AdjustorThunk','_Enumerator_MoveNext_m5F412DF9813EAE029A13B8121C12EC4C6E6ED5FA_AdjustorThunk','_NativeArray_1_GetHashCode_mB01FB9FBB448F1F28EE872360A707AF80C6844BE_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC0CAC10603A014E1FF1ACC14F1181BAD496E6333_AdjustorThunk','_Enumerator_MoveNext_m5FE0B4C25E9A92AEC9324D4DD8D22808F485414B_AdjustorThunk','_NativeArray_1_GetHashCode_m6DF177265D7E67F22FDA1E8DAFD4B9570964A5F8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB09F6FDE5010C9CDDFFD74C5C5A8B4846B6044BF_AdjustorThunk','_Enumerator_MoveNext_m78795DDAEA4D8F4592D892FA390DEF2720E21D81_AdjustorThunk','_NativeArray_1_GetHashCode_mF148753FE183733DB42C8D3E3A84CA34AFF7402B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mDDE7CA54DCFAFB4601846707EE00C42124720AFB_AdjustorThunk','_Enumerator_MoveNext_m35E8BF03333797E447C94ADCCFFFB6BA024CFC10_AdjustorThunk','_NativeArray_1_GetHashCode_mE699A041F8E786E2E377FD9E01A1444D68E47755_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m977752CCBE44A74BC3FA3CA63FB902538BD1379A_AdjustorThunk','_Enumerator_get_Current_m47D02BD36727DC2105878C611D37BA979E861EFE_AdjustorThunk','_Enumerator_MoveNext_mB2BEAD1D8E8AAD74725E82E0CD438EE2C07DD9BB_AdjustorThunk','_NativeArray_1_GetHashCode_m0132F694F4EEA1365041EFDDC4A514053F014390_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8BC32240E4D98AA605BE8018BB1B892756752D45_AdjustorThunk','_Enumerator_get_Current_m651CDB4D9A9548A4E3DB921397FE628B420DE1D8_AdjustorThunk','_Enumerator_MoveNext_m86506BC12F8470F465A395551C545F9E0B1A399D_AdjustorThunk','_NativeArray_1_GetHashCode_m9CA3485F400A954C50CD4B8BB0C7E071837D814B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m08715B7AD2C27C9056F5C78E14254171E911B2CE_AdjustorThunk','_Enumerator_MoveNext_mA4FEFE928FBDF72AC4AA9795BFBCDE40B33A37C5_AdjustorThunk','_NativeArray_1_GetHashCode_mDFF0BEF0195CB4B3751DE9FB0D1254FF4C5C3A1C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m82F6AE4D4AABDC7F0A64B7213713B6A1F20CD12F_AdjustorThunk','_Enumerator_get_Current_m31CDBAFF229FE44AC2E06B9209115A1483DBF365_AdjustorThunk','_Enumerator_MoveNext_m8CB4CBDCED58E88A4F6879C399557812DC1E7C29_AdjustorThunk','_NativeArray_1_GetHashCode_mDE4FB149D162F6E791EFFC1599F3508FCF0FC3BF_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m570F03F3EBF2C466173914B020050C50A3D86DF6_AdjustorThunk','_Enumerator_get_Current_mC458246B3A7E568B430E5B4E38FA3E7B5841220F_AdjustorThunk','_Enumerator_MoveNext_mC6094AD1A2836328C7D0CCE0AAADEED0DE395C02_AdjustorThunk','_NativeArray_1_GetHashCode_mF2F7D669EB5459D75C5FEB5E3F9F24753EBD758D_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m85C6062E17DF4D35FD0BA44ED1E9676C344540CA_AdjustorThunk','_Enumerator_MoveNext_mE01C097409709640D77A6ADADD2C875F5B990E9D_AdjustorThunk','_NativeArray_1_GetHashCode_mBF0D1FB9B806A9976B02ED09E1C4A0485897A393_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m2747898267B6A48956BADECA65F2BE7F759788D1_AdjustorThunk','_Enumerator_get_Current_m73B05077FBB4AF908C0300658883A9310A8CF1A0_AdjustorThunk','_Enumerator_MoveNext_m2D20BB42A3C45D1F3399A63FBFA54BA1DC2E6EDD_AdjustorThunk','_NativeArray_1_GetHashCode_m78C7793D4A50F535EFDE08FFC3FE3E01DB8796E1_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC1E1DCC8FE4AC95A28983EB29F87C3AEEBBBB135_AdjustorThunk','_Enumerator_get_Current_m6E56A1D70E342BF4AE212C6AF784A3DDAFDA6262_AdjustorThunk','_Enumerator_MoveNext_m2D9B9B5A80748C5649DD7D6129010E5B095FC3B5_AdjustorThunk','_NativeArray_1_GetHashCode_mDF566053EBBDE02D7DEC3B08FF06205AF15063F6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m37D4437C91110748ACD7D90A48B27D3E8DB8224D_AdjustorThunk','_Enumerator_MoveNext_m3989C558ECE1E471800FDA6BB7A43AB6F3631AF5_AdjustorThunk','_NativeArray_1_GetHashCode_mFEEE0CF795102BF6806E97A14C25E62773ED2634_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m21942F1B6127BE4E2698C47145BB82A3EEA7A7F9_AdjustorThunk','_Enumerator_MoveNext_m0C8DEFECE802B01BDFF9AB4B7E0EADA11B3CC901_AdjustorThunk','_NativeArray_1_GetHashCode_m41147598ADBA07697A130FF53800289B68CFF3D4_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB3C112A125722E4FBFF0855F604EB5133D209C10_AdjustorThunk','_Enumerator_MoveNext_mDE12BFD7BCC1273F6F2C6F977B4FA2CC1385ECFF_AdjustorThunk','_NativeArray_1_GetHashCode_mF1A0C0A04D1416921247E8E5B0F6CA955C8651BD_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m78BD8CD64861000737DE1D2C16C4A398DE95934E_AdjustorThunk','_Enumerator_get_Current_m2254E3EB85546ABF1846F8E20A43BC7B579A4255_AdjustorThunk','_Enumerator_MoveNext_m94870E7FAE8ED0F08AD256C3AB1B367AFBD61CCD_AdjustorThunk','_NativeArray_1_GetHashCode_mB2CAE3991118BF8152CDF115663568F5D73571A1_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m6F086100074622698DB91CE27958EA2C89728B3F_AdjustorThunk','_Enumerator_MoveNext_m100F84EBE5C9295EB382FB60942F804FB36AC0C7_AdjustorThunk','_NativeArray_1_GetHashCode_m85420364696EA19384FAD7C9D16498452DEE2DB8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m94795203BDFC019C032D5D2F39928F55E42ED017_AdjustorThunk','_Enumerator_get_Current_mAE6F89C632D44E5D860F51BF0A8EA54E48DF8EAB_AdjustorThunk','_Enumerator_MoveNext_mC4D30C0C1AD416718FAE579C08483B7A9690B390_AdjustorThunk','_NativeArray_1_GetHashCode_m64083E59B3B993FA57EAF3DB0345E8BB0EFA6D48_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC0FE8F9BB71E1763B671E039F04C26EF11442F70_AdjustorThunk','_Enumerator_MoveNext_m3A9694F65CC445D9AC7BC57A42471C39A72B908D_AdjustorThunk','_NativeArray_1_GetHashCode_m8A650DB09071F691613193C6F4F24DBB593E0820_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m88D819512A23462B4D8881BB6256334B6FF3009D_AdjustorThunk','_Enumerator_MoveNext_mC9C24FEB4DB6082E6C18FE5F8DE9269F930CACCD_AdjustorThunk','_NativeArray_1_GetHashCode_mD0F1C4A7869E65C137D1FFBE4FDECE2B2448507D_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m49F7301FC81E0732B564FA4FB8C915DB656F0ED0_AdjustorThunk','_Enumerator_MoveNext_m05CF4F830F7ECDE582644DF276FB8695A44106F0_AdjustorThunk','_NativeArray_1_GetHashCode_m45256F26E202CD5B60D61C8106D45BD65DF217EA_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA2DF36F21E259C8E09B80BB2DA9B73FDFDF40BF0_AdjustorThunk','_Enumerator_MoveNext_mD775640F9B28C53EF9846CB4FFFAF995527C9EA6_AdjustorThunk','_NativeArray_1_GetHashCode_m587F9F595CBEFDE9B8D604AF4C18503C1C3DCFBE_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCF9EA67C1E2C033CE45710962698D19BDB6ADC5D_AdjustorThunk','_Enumerator_MoveNext_mAD9F82898B9DFB7D5B40C14A51D2CC52CCCEB23A_AdjustorThunk','_NativeArray_1_GetHashCode_m48878CC30FC898A49C3EEEB02BA0CD67DF080538_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB8FB2D43B2F6C2E05453E2E32C31B15867A46B9A_AdjustorThunk','_Enumerator_MoveNext_mC43BD0F7675BE140063B2274E6417983526915F8_AdjustorThunk','_NativeArray_1_GetHashCode_mA6A58498AB099E53DC963525A0C714EA8FA6D1B6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA6219B3ECB0B19522F631A84737FE9E63BD3AB17_AdjustorThunk','_Enumerator_MoveNext_m797BF6CD417963744A735878151B95DE7408A167_AdjustorThunk','_NativeArray_1_GetHashCode_mA69ECF6C550CD4F2BB059067F4B6B6370A97AEFA_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m519776AD804099B7335564E3A5041C225CA1240B_AdjustorThunk','_Enumerator_MoveNext_m1B97E71E1B87E22536A4A6F72F900AA771D198B5_AdjustorThunk','_NativeArray_1_GetHashCode_mF58ECABA60AC20DD2EE7C52FC91365C4F455071B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m3A8B27CBBAA41B9578A0EA34F996673D89EE1B82_AdjustorThunk','_Enumerator_MoveNext_m7752E23A998BA1645EE9495FD0476DEE4AAE61EF_AdjustorThunk','_NativeArray_1_GetHashCode_m44069244AD4127519C8BFCB5F6CD2D6DB0D34293_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m77ABD968B46C6505FAA20D243FEC1456BE4D8544_AdjustorThunk','_Enumerator_MoveNext_m1A9FBFD01EFB2031FD141A3439E33AEA1A7C91B4_AdjustorThunk','_NativeArray_1_GetHashCode_mA81C1A37046803E751D20747D97F288D30BC17BF_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5559DED8C55D850BB8AA290E261136245A07647E_AdjustorThunk','_Enumerator_get_Current_m96252C159B3E3C80277F6860B3B58C2DAB1B3BA3_AdjustorThunk','_Enumerator_MoveNext_m1D18A3913BF70E9C0191AF2FE818C4AC03A5E5D9_AdjustorThunk','_NativeArray_1_GetHashCode_m06C58DA0B8B840F351FBF07CA72F29EC80A898A9_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m50BA0066CD2546AD1956081DE4BBB17A7E465B80_AdjustorThunk','_Enumerator_get_Current_m4B92A87E000567CC07301ED565ED36E24BD30D97_AdjustorThunk','_Enumerator_MoveNext_mBF6317C8118E3555072454FF11018442F612B608_AdjustorThunk','_NativeArray_1_GetHashCode_m47741E769D6E3841C7789E6503752F4C7112F762_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8C7BCA506E11F0FEED4E1BF5C42E8E2CB2055862_AdjustorThunk','_Enumerator_get_Current_mFA07A9E188387215A2CAD0ADC8632CACE183EFF4_AdjustorThunk','_Enumerator_MoveNext_m179866FAFB8D880AD4BD1D698D521DDD7BD348C8_AdjustorThunk','_NativeArray_1_GetHashCode_m51999C5EA60B6877CE66BA1E5EB39AFF54F6FBC8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCCE8C373F62D0669568C44401B49B3D87ABAD2BF_AdjustorThunk','_Enumerator_MoveNext_mF4CF2587098C759F4877F01503CBBD4BF44965DE_AdjustorThunk','_NativeArray_1_GetHashCode_m2BD2ADD3A3735AB386E8729563E3C2584C59F7CE_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8D03E2E1588B54F45C313D943666E9C652FD3468_AdjustorThunk','_Enumerator_MoveNext_m42EA38794F4752058E193CEEDB66F6C7D8F574C2_AdjustorThunk','_NativeArray_1_GetHashCode_m7ED808A7CFF7C83B24983EEB4EEE5DAD44C3FB33_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m97C29E07B6DF206CF836955E36B4A4B4BD3ED836_AdjustorThunk','_Enumerator_MoveNext_mBA9E143A5B58809B63C9C19F0376AD6C6C9F32DB_AdjustorThunk','_NativeArray_1_GetHashCode_m9D43C814EBB972DD0E8190380CABF75C222AA164_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA95F7E97CA29CB41A3232E9431E43978D551D953_AdjustorThunk','_Enumerator_MoveNext_mEA9E92E1CF7671E562A6E3C73BF5C51C9FA81F3E_AdjustorThunk','_NativeArray_1_GetHashCode_mB739406E22B8F525902455D30AE7C227E0841AD6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m23773B4ECAE3FB70728CDA585DD3D7525687D81F_AdjustorThunk','_Enumerator_MoveNext_m5C5B06BD0EC2B179B0487337F908ABB140B78EF7_AdjustorThunk','_NativeArray_1_GetHashCode_m5CBFDA3EBA12782FED05D0D7F020411940E17C26_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m1ABB9A29662ABD8C19273658E8A0A45A60F1BD30_AdjustorThunk','_Enumerator_MoveNext_m12AD40832119AE9A506B8D1179D2091880D214AC_AdjustorThunk','_NativeArray_1_GetHashCode_m61F98C3EAAFBA68E349A53333E519BFB222D837E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m543FE7393309DAE127B48E7374D3906EA5949B0F_AdjustorThunk','_Enumerator_MoveNext_m40DC24F91C0615ED9F7C17FC0014F6FDA14108FA_AdjustorThunk','_NativeArray_1_GetHashCode_m73C6756E39EDA9DC903CC7D4D9731466F0D3A7A3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mF448D2816565877496B400CEDA84A47ECA1C47E4_AdjustorThunk','_Enumerator_MoveNext_m117BA60F7AD31E344D47042E9FF8E2D604B9C07E_AdjustorThunk','_NativeSlice_1_GetHashCode_mF070C0E9CDF609F973279F8981015D8B0E6B1AF5_AdjustorThunk','_NativeSlice_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mD9A05C814BF44F067F263A1AB5B722C2EFA5C532_AdjustorThunk','___stdio_close','_StaticTypeRegistry_DoHash_m518A9594ACAA279C210405E4DAC2DA378D37EFC7','_StaticTypeRegistry_DoHash_mC055F0D155C4DB54347FA2CB2386A5F63CAFEE1B','_StaticTypeRegistry_DoHash_mADB186C84491119406F2275436FE227B82D1782C','_StaticTypeRegistry_DoHash_m0EB386C558030CD42F7F498B695DAFB419CF9D1E','_StaticTypeRegistry_DoHash_m09178D23F9C99711913D739F44EDACEF75C915AD','_StaticTypeRegistry_DoHash_mADDAD9997BA00491C16D8611DB62BD13D2BC7129','_StaticTypeRegistry_DoHash_m90688C24EB6AA539540B4F11F526C7631B2EBB34','_StaticTypeRegistry_DoHash_m2F71CAEB7F90C64E2160A4A45C41CF016AD4EB23','_StaticTypeRegistry_DoHash_m58283641E7F2421E6246EC53301C63EF4BD252F9','_StaticTypeRegistry_DoHash_m90041D472677A397ABB87AE8621423B2C1076001','_StaticTypeRegistry_DoHash_mEEF134DBA1DBE5EE30E46E1D28A7F0A10195C910','_StaticTypeRegistry_DoHash_mE4BF3E6DEA898D0FEF6DB5C86C5202677400511C','_StaticTypeRegistry_DoHash_mE420786AA2731493933770F085CDA914E13EAE22','_StaticTypeRegistry_DoHash_m4C033A75967DC0132812846728250C405A6C4A04','_StaticTypeRegistry_DoHash_m79B7FD8A36CF60BC886DC5ED2B654FAFAA03C169','_StaticTypeRegistry_DoHash_m33ABA6622E3CD8DC59931C6F034B5B1159A332CF','_StaticTypeRegistry_DoHash_mD76821656BD14593F21AF1ABEA32385DC28B0CFA','_StaticTypeRegistry_DoHash_mB2F08213B11B100368D78C67914B23562639DA67','_StaticTypeRegistry_DoHash_m48FF0356E445EFF9BC940880C81535485DEC3B20','_StaticTypeRegistry_DoHash_mA23ADA6C85DC4DEADE6E99D60BAD0FE526FAB589','_StaticTypeRegistry_DoHash_mEAA021D8131F638A3DA3BCCA5AD234EBA57E8C02','_StaticTypeRegistry_DoHash_mD0A6A69504F1F90AC8D66244243BD1D32F87ECAC','_StaticTypeRegistry_DoHash_m06952C8E782B4A96F4B4E7113D98F705329A5663','_StaticTypeRegistry_DoHash_m70D5CB13CA3498CF4A60869197AA82489D5535A7','_StaticTypeRegistry_DoHash_m386ED1B269115EF474C9AD271679314A30310220','_StaticTypeRegistry_DoHash_m87B4B6E0EFEEA6774ABB4DF0EBD4DC1A6F945754','_StaticTypeRegistry_DoHash_m49325C25601FBA4E61A4DC4A2285366059B72814','_StaticTypeRegistry_DoHash_mA231B231F382D237B24E3165390A4AFB64C808BE','_StaticTypeRegistry_DoHash_m37DDA0395F9A2517E9ABD87C9299DFC9AFF08D00','_StaticTypeRegistry_DoHash_m1BBDB08A05390AE64A94AF6D2EDBAE3B0328E1AF','_StaticTypeRegistry_DoHash_mA978B64630E0B7542745D34274876EBAB8C8F50F','_StaticTypeRegistry_DoHash_mFDE9F96D5D44DFAC8DAC96AC6122AFDC9D98B9C2','_StaticTypeRegistry_DoHash_m8CE4B8E100A6150D2F3BD97C532173EF587C810C','_StaticTypeRegistry_DoHash_m50455AC555282A62784353936EA0DF51CA740341','_StaticTypeRegistry_DoHash_m13C485452C9633507B54E744C8346062E61EAF7B','_StaticTypeRegistry_DoHash_m232433A337214DE2AAF9002877E4491189E18CA2','_StaticTypeRegistry_DoHash_m34F5168BF8AB6705060D8065B07A31826E990708','_StaticTypeRegistry_DoHash_m4DEE63E766FBB194C48F568E6BA1A05944AE20C6','_StaticTypeRegistry_DoHash_m7E02A1E24E999DA5EA177939FDD8FB964C6A4A1B','_StaticTypeRegistry_DoHash_m4CD30313ED2D00D457378B362C17ED2D2790C40E','_StaticTypeRegistry_DoHash_mC70A43B82B99F56C471D628421252C72838F27E3','_StaticTypeRegistry_DoHash_m49418C9B62CC013BCAD4DE346CBFE74DF899BBD0','_StaticTypeRegistry_DoHash_mFD8A263F283C32E7BAE614B6E5422B5343683865','_StaticTypeRegistry_DoHash_m9C37058BBDD4B8475533C52AA5046796EE105DA8','_StaticTypeRegistry_DoHash_mB4BCD078684D1850F206ACFF9E2217649FC63F31','_StaticTypeRegistry_DoHash_m0A1DD5DE5ADA6D4045DC65615AD55C59235B3A33','_StaticTypeRegistry_DoHash_mAC2DF158385C773FD358D6CA4A0E18B618623F60','_StaticTypeRegistry_DoHash_m37D3BBB6BED862146518CFE1E8E7B620BD9CC730','_StaticTypeRegistry_DoHash_m990DB958B94961B17E149A7637BC4C93161BB959','_StaticTypeRegistry_DoHash_mDE1D326A0A4BB1FC7A4C12609A49D437E5FC981E','_StaticTypeRegistry_DoHash_m6B6FCD76DA877598A9DD82F94A4C7BEE1B8A5520','_StaticTypeRegistry_DoHash_m1057539989E30AC0733744A8A774369A3E5B2FA2','_StaticTypeRegistry_DoHash_m0F766468E515731CE3983348B9A4C690810E7EC2','_StaticTypeRegistry_DoHash_m4EA05FC38B93DADA72D7ABC4F2F11AD504DD3B0E','_StaticTypeRegistry_DoHash_mE833EE624FD2AFB6034C9C572DBDF34E7F0F2FFD','_StaticTypeRegistry_DoHash_mF9AD09F6D76759FFAC1CFBBB004384CC853371CA','_StaticTypeRegistry_DoHash_m1F785734C6E782059080B84B585C52F637785C63','_StaticTypeRegistry_DoHash_m5618218F2ACA31A897EA117A830436974C3AEF27','_StaticTypeRegistry_DoHash_m5F9C776379068A16960F14ABF627CBE59D4A1B96','_StaticTypeRegistry_DoHash_mB693D2C3266BE1B8C89276152C65D10604F7A9CA','_StaticTypeRegistry_DoHash_m2C9A2D3AB4B1970C283728A053151E8472B6B7B5','_StaticTypeRegistry_DoHash_m46FDCF62512693524A32922C491EBA8A0D3452E9','_StaticTypeRegistry_DoHash_m69CD3D131A9A759A1C2A75A5E09C67E3E4E9A846','_StaticTypeRegistry_DoHash_m64C12EEE53CED72CDE3A98EA2567A50114A4E0C8','_StaticTypeRegistry_DoHash_mA79F80B34056BC7D74493D0436CBF075A04088DF','_StaticTypeRegistry_DoHash_m1EE1358C8A7B31968B229C843331825A76B17D53','_StaticTypeRegistry_DoHash_mBED42FFB54CEF56E78D0EA565C37E2DDAC96022B','_StaticTypeRegistry_DoHash_m13045B0821E8FE324CAC613D475537B31C949944','_StaticTypeRegistry_DoHash_m6E09509C6858302040E2C35D631879EAEEF0899A','_StaticTypeRegistry_DoHash_m776031B90BE94FC5F32CDD796E0BDB97B9A57E3B','_StaticTypeRegistry_DoHash_m4A04C59CCB5F4E78F3EDAF3563BA4307E87F6807','_StaticTypeRegistry_DoHash_m5EB52D21287408631C6EF50FE12ED4F846A4E650','_StaticTypeRegistry_DoHash_mE7E01BF738F770D0324D5919E453B7D4FBBB4CDD','_StaticTypeRegistry_DoHash_m85055AC24F311436E6E3E6D74E34E35C8978581F','_StaticTypeRegistry_DoHash_m70C039CDED5957AC1122F4FB09D36792AE19F64C','_StaticTypeRegistry_DoHash_m6B9AF95E3F1BDEAD431BCF832AC617EC685FA974','_StaticTypeRegistry_DoHash_m5AFF375B94E9FA58EC09B9A179C1F9D391DAB178','_StaticTypeRegistry_DoHash_m994D4A6F8B4B7F32A6A4FE6764B476D81F8354BC','_StaticTypeRegistry_DoHash_m76BE1FD5B2F1E4D89142B36F1869909BD41C083B','_StaticTypeRegistry_DoHash_mF85FFB350B51808DE3C2206FD201EB3E6868A7E3','_StaticTypeRegistry_DoHash_mDE9E29482D4F9043CE24484084E34F3336A39519','_StaticTypeRegistry_DoHash_mA00AD342E5849C6FA8242FBEF43D7E8E5E5C1939','_StaticTypeRegistry_DoHash_mE2CD2AC96243847099CA36733887E2F6B90C40E0','_StaticTypeRegistry_DoHash_m15E88E05111DB52F0D4461E35BEA47ED2C19BF90','_StaticTypeRegistry_DoHash_mB14F8BD32F2002F493FC2D217647E0816FE75B45','_StaticTypeRegistry_DoHash_m51CE6423B9EF95AB13B856D118FCDFE80DA1C72B','_StaticTypeRegistry_DoHash_mA061C64EE0F90F7C65F39B872D5EF7BEF8ADF081','_StaticTypeRegistry_DoHash_m3B7DC7119186B679132386249EFEB5107BC65C3A','_StaticTypeRegistry_DoHash_m707F00690610244679CF011F3430B140E232549D','_StaticTypeRegistry_DoHash_mC2098BC4398EB29210821F136A60DF09A474C419','_StaticTypeRegistry_DoHash_mB41A35A3E77E1F97F2F0AF2AADC614DAF2B5FF1F','_StaticTypeRegistry_DoHash_mB38EA78F07001DB0B6D3056B212619299316EE09','_StaticTypeRegistry_DoHash_mF09C084B33FADD98E24625D70A899FA7880C9914','_StaticTypeRegistry_DoHash_m9E0FEABDE9DCCCD7AAAD6E75653ADD763B003D0F','_StaticTypeRegistry_DoHash_m590BB5786D58F3902B5E568124B5D2A145698BF8','_StaticTypeRegistry_DoHash_m98665477E028F4A5DCFA1F7F36FEA757A80F0686','_StaticTypeRegistry_DoHash_mAAF679DB646608671F88E9A765350C6A92070735','_StaticTypeRegistry_DoHash_m8FD5FC6B6594B3C0C68B3883CAF20E5F4AB54924','_StaticTypeRegistry_DoHash_mA83A0367EDE69A44708F036458028995BCF08850','_StaticTypeRegistry_DoHash_m8D96AF50D7EAEDF9E2CFB6BDEB5411D7DB8F2CA6','_StaticTypeRegistry_DoHash_mBF00AD052341145B5B6EECEB33813A3173453455','_StaticTypeRegistry_DoHash_mC841E3F0C9C8237ED5CB19C0066D6DCC5025114C','_StaticTypeRegistry_DoHash_m84164DFDF58C1EC9B454ED9610E2EE88615D8837','_StaticTypeRegistry_DoHash_mF226255AA161EFC2674ECD86ADB663FB2A5E7647','_StaticTypeRegistry_DoHash_m974C303B0031C10A6EFBADDE386B6389375A9A56','_StaticTypeRegistry_DoHash_m775D93AE5B087D92046E8429E655DB075B44026E','_StaticTypeRegistry_DoHash_m17B4ACE175BEB82690C3AA6D1CEB40C5084A9CBC','_StaticTypeRegistry_DoHash_mFA2ABB8B043724BAE874C261DD515DCCAACAE92B','_StaticTypeRegistry_DoHash_m6CCE9196AAA5B7AFC5F1EDE56E0679EF3F67C120','_StaticTypeRegistry_DoHash_mF84A6510EFEBA23856854EEEE7236E8D774D0A2F','_StaticTypeRegistry_DoHash_m5A8EA04A49950D2E808FA8CB67DC7CD4A03FF192','_StaticTypeRegistry_DoHash_m7AF1D5717BF32D300176765303D421FBE9274103','_StaticTypeRegistry_DoHash_m7FF8AF5AA5F36C1EFCD740A58F01D643EDF878FE','_StaticTypeRegistry_DoHash_mEFF33A77192A46607B9F89A1FF80A453E4498F16','_StaticTypeRegistry_DoHash_mC20964E56CC2D1AC5245CF1C9153E62F4BEA3813','_StaticTypeRegistry_DoHash_mD5FA1870FB48993CFB2720A0F8F3F4F8A1BD0817','_StaticTypeRegistry_DoHash_mF0C8BA311211AFC56A921C0DA5D6520F6E9CF82E','_StaticTypeRegistry_DoHash_m54EF5555B9C5F85F66BF57BDC5FE462E44D6C598','_StaticTypeRegistry_DoHash_mA1EE4705F7554FC2B8CC9A711C6C31C514C8667D','_StaticTypeRegistry_DoHash_mCBAC5E4762071D04D932694A81ECE0813FBC6D5B','_StaticTypeRegistry_DoHash_m5854D8673ED1C6AED338938BDC1EE55BF757160E','_StaticTypeRegistry_DoHash_m84CAE1A19B733730C31CA815AE2BE7963399EB9D','_StaticTypeRegistry_DoHash_m1C2B8EA78F85FCBCCFD8D884BEDB9DB5C0A17DAF','_StaticTypeRegistry_DoHash_m83CDB62C2818619AEC3A1A9DB87EBFB156D6F81D','_StaticTypeRegistry_DoHash_mBFE0AEBB9DB922A0FB7299AE466491C4304B1855','_StaticTypeRegistry_DoHash_m47E10F05C5434AC904A1BC3D54106427806E2B8E','_StaticTypeRegistry_DoHash_mD656E9A51198C539602E9DF8E534CB5F5F83D907','_StaticTypeRegistry_DoHash_m476E0564696C87EED05230DF74658DC07AD08677','_StaticTypeRegistry_DoHash_m5192BDDBF26FD308D3399DC485DBCCA1C2B123D0','_StaticTypeRegistry_DoHash_mE44CC0192491785964077DCFC9A816465D82715E','_StaticTypeRegistry_DoHash_mF98D1E8686A24DAB38D74591039C549345340E0D','_StaticTypeRegistry_DoHash_mE3B07A096DE3076C006C15BD9E38B5DEA62A467F','_StaticTypeRegistry_DoHash_mEDF002524890C292F9B2FF4476FC82A447148687','_StaticTypeRegistry_DoHash_m1CDC6D37379736F867E07D1ADB9AD8CD160EED43','_StaticTypeRegistry_DoHash_m0965C68D94239F35BDBFE951DBD011495C95B6AB','_StaticTypeRegistry_DoHash_m1CDE85F9783455A36D23E58CA48506F6AD1E0D62','_StaticTypeRegistry_DoHash_mDF3D8FAE5C62F126CEAEDC17F58DC1B6480A22DB','_StaticTypeRegistry_DoHash_m1DB3386EE98C35745D25433F4D62A079A8CBC622','_StaticTypeRegistry_DoHash_m5085BBD78B4FF2D057EC99E099C912F770418088','_StaticTypeRegistry_DoHash_m5290DF8F647E2E24380635191EA533C809EEE808','_StaticTypeRegistry_DoHash_mA24B4E3BF7BCD1E4EA8F3597D9BE7EF3E5FFD0BF','_StaticTypeRegistry_DoHash_mE574249A2C766A8C7433165AF644F5A3E8C1778B','_StaticTypeRegistry_DoHash_mA007DFF840B84D0D1411EF44FA875F40ABCB1626','__ZL10RevealLinkPv',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iii = [0,'_Object_Equals_m5474383677DDC7962A16D23822FCC19C934F4EF9','_Guid_Equals_m30B0EDD5E3FC5FE65173A5EF4F23D8D425C19052_AdjustorThunk','_Guid_CompareTo_mDEA1DB265A83C97E5B74301D348C00E8EEE8C369_AdjustorThunk','_Guid_Equals_mB7F9B1ED8DE4DEB4FEDBFA46BF375A00AFEFFDFB_AdjustorThunk','_ValueType_Equals_m7E3BB926A8DC6A9A6FE29C4B5965B19DB79C073C','_IntPtr_Equals_m7550A5A34C0881411739C5A703683137C007C212_AdjustorThunk','_String_Equals_mAC5FC349F198E752C5D209E261A052B7D463E6E1','_Enum_Equals_mD385DD5BBBD1484CE5B8A60151BAD437C5A5E5BE','_float2_Equals_m9BBBCE24B4D4AA27B00E9E47B918A3C50D1E8586_AdjustorThunk','_float2_Equals_mFBDE8685F782E45582D0F0646037892DDFF6FE75_AdjustorThunk','_float3_Equals_m918C76BBEDBD564FAF06147E5CF7378BA66269A2_AdjustorThunk','_float3_Equals_mEF30A0802E511E7E3FED72575B0FF28E76A75884_AdjustorThunk','_float4_Equals_m94A70A44A1978103ABD1991A3B39E42F6EA094A1_AdjustorThunk','_float4_Equals_mDE67FD9A8E9889C3A674C13B2D61D9646E48E7DF_AdjustorThunk','_float4x4_Equals_m8916D2F2ECFFF22B03BC35EAA91717668ABC2E95_AdjustorThunk','_float4x4_Equals_mA7593CE7D4C33DB976EAA55EDBF8FB10F0DA15B3_AdjustorThunk','_il2cpp_virtual_remap_enum1_equals','_quaternion_Equals_m82568B42004ABD01866ED53C071D914B917CA29F_AdjustorThunk','_quaternion_Equals_m222DA21570CDFA098F8FE3668F5EDBA668016A02_AdjustorThunk','_uint2_Equals_m98B2E34E9EAB4835972E125C3AA431531C00506B_AdjustorThunk','_uint2_Equals_m048B74BA5BCBD0F77A124F0D1D473AABE4246427_AdjustorThunk','_UInt32_Equals_m3F40CBF17CEF6831D70EF5A337E7F3975D8A4324_AdjustorThunk','_UInt32_CompareTo_m8FF4E3BA793BA133CE4409C43559F1BE22E9418F_AdjustorThunk','_uint3_Equals_m8D28099A284A5CDCFE6EFC40C281F711016264E9_AdjustorThunk','_uint3_Equals_mBF7E3470B4E518C70622309C8D7BDFDA81357984_AdjustorThunk','_uint4_Equals_m33109317AA70C4E68971D054AD2820D5F025EE60_AdjustorThunk','_uint4_Equals_m6B7C0ACB217EF002B911FB6059B747FBE8FEBD11_AdjustorThunk','_il2cpp_virtual_remap_enum4_equals','_Int32_Equals_mAEEF0F8FE79D3EF5E69A1EB3DDC0571F79AB3BBD_AdjustorThunk','_Int32_CompareTo_m163D453012D43176210C4E876EBED081913EB26A_AdjustorThunk','_AssetReference_Equals_m9D170741FF32A1A1CE73C8E877A131974792A835_AdjustorThunk','_AssetReference_Equals_mE79846224EBF6D55C1034157793F92528E943F06_AdjustorThunk','_AssetReference_CompareTo_m122436B2627634A2FC271DEC89C115CDC61D320F_AdjustorThunk','_Entity_Equals_m9256E1FC61326809120F15B6BFCC211888479C97_AdjustorThunk','_Entity_Equals_m856ABDE4AB8D4FE08E6179C6088F0FD5A587D5B9_AdjustorThunk','_EntityGuid_Equals_mDC0450A13BD216374AC42EE82FBE12EA7B2DF3CD_AdjustorThunk','_EntityGuid_Equals_mBC74ADC52AFBC4BDD770432ED8552011D146D69A_AdjustorThunk','_EntityGuid_CompareTo_m65AD38B940C7D23557F877EBC3245BA63FC37792_AdjustorThunk','_SceneTag_Equals_mF3A95B4D8FF68902826D2FE43C36F57BDD98B417_AdjustorThunk','_SceneSection_Equals_m43C305636B9A0322D280E63830EE6978CA498D6D_AdjustorThunk','_SceneGuid_Equals_m3EA20280C62FF8D08E1EC858EAF50AE59FF52150_AdjustorThunk','_SceneGuid_Equals_m3D83EC3E8775E4BB588BE4201F0D49EEC5FB7C38_AdjustorThunk','_HashFn_Invoke_m7E4508F7D2946D15D5214F14A88BDD1F57616AD5','_HashFn_Invoke_mC4D008B30A02ECB18A64C03E0B56B24D1B7747CA','_HashFn_Invoke_mD68667EE7AA0E5213FC82784FBBFC3B3E7A45D85','_HashFn_Invoke_mC4CBB50FF9747B6345FD063A125CC6C71708696E','_HashFn_Invoke_m21CF540BF7649EE6B514250D005B93E442E9B37F','_HashFn_Invoke_mDC8A8C164042FE325D5CA92E41320B39C21E8189','_HashFn_Invoke_m85626CDBC041DCE77EC0FFEB33DC68F5EF321F19','_HashFn_Invoke_mF82FD7C5BB5DC6560C7D8628BB1DBBF5C8FE41C5','_HashFn_Invoke_mAF7CFA5D6FFDB1A5F2EF8D34716C1D4AF41E57F9','_HashFn_Invoke_m8A2C355E4C4F624EDA393BC0C8DD804362DE9764','_HashFn_Invoke_m4538CB68BFC1DB4B5C0326FE2CC7AD315E3E6A78','_HashFn_Invoke_mA304D6BA3918C75016D0EC3263EFDD8E8DA2477F','_HashFn_Invoke_m83FB1768F074E00F140AF31E4C7C838B17DED488','_HashFn_Invoke_m590F90DB34A57B1714CD43737AAF56D2CDF05D97','_HashFn_Invoke_mE6F31AE172A8D28FCB207CDBB74504ADBC9CB2D5','_HashFn_Invoke_mF2ACC5EE023B3855DD76B51F1116F6A0BFA73E10','_HashFn_Invoke_m044819FC10154476A0C4BB8622530203C078CAE4','_HashFn_Invoke_mA015B479B053B05C348391D073D78FDF5204F1C8','_HashFn_Invoke_mCB74302F755B89CB562BCB66C4F9A709AA8679CE','_HashFn_Invoke_mE5621EE29D5A977BAE840F9943FE54A8A1874D9F','_HashFn_Invoke_mA7F133323859A63441761178E9A03F039E2D07DC','_HashFn_Invoke_m1E1CD6DF88DE4037BCDEE227B7A1E107375C2EE1','_HashFn_Invoke_m5E3781910C12C3E88B213850659F8538270D73AE','_HashFn_Invoke_mA1779EB03821C2DA8C730E2C9E7BA30742441B38','_HashFn_Invoke_mC62B27C88B8B200426D46A6F29B3B8B24AA0EE96','_HashFn_Invoke_m610C6CDDEBB291FF2695C46CD89F117E1309E1B7','_HashFn_Invoke_mFCEC3798AB2333E0CC48FC069E08EDF6B2A10C63','_HashFn_Invoke_m88E98D5C39C4BBD9F3D6F6F880C41D17890FB8DA','_HashFn_Invoke_mC92BDFB6F6840436921750972FECB4362A0F757B','_HashFn_Invoke_m71E39D8736D05628852DAF20809C136B7E0D610F','_HashFn_Invoke_m6460A864227DC673832CA4CEA59FF596FC8FB590','_HashFn_Invoke_m7EC128B5F998F52C7BF1DABC4111F3354BC94907','_HashFn_Invoke_mCB6EE58F137D7B69DBF35F138122D6BF0C03D666','_HashFn_Invoke_m64D07C10363FD8C4A3D08C84B37A1627B290C0C3','_HashFn_Invoke_mAF71F8DDCF4EFC0093904507E5C269B5B252D012','_HashFn_Invoke_mFCFA126F0BE0ABBE56C40C2D5B01F0FBD10C4DEA','_HashFn_Invoke_m1B51234A4E3024415CB61302A50673ADC07B1254','_HashFn_Invoke_m469EF8EA366EA5A611BBE31AF11C5DC974CD7ADA','_HashFn_Invoke_m01DC70FC0AECAD17CE00F9B3A37604DEBE8A98D3','_HashFn_Invoke_mA598CFC88CD821FA0B008FE7B6F10D271B8131DE','_HashFn_Invoke_mDD24A1C371B5C73CAB96F12CDB08C70224797EE6','_HashFn_Invoke_m98B8C8D805D424BFA6A5983919280CC53A71814F','_HashFn_Invoke_m46FBCCB5695A48523A8A2D50F93A9DF6737BA58D','_HashFn_Invoke_mA50355135D35E557E831622FCA3B11C12818FCEA','_HashFn_Invoke_m193E1A56CE909C48AF4CFC4BAAC19F1B174B7B31','_HashFn_Invoke_mAA44C0CA0FA21CDB6AB80FC1E187489CECA7837F','_HashFn_Invoke_mE31EF7B5B9772AC47C4229E3790D36001FD7443A','_HashFn_Invoke_mFF633D3ED931F7CFB75D2FDB9088FE11A42A55E8','_HashFn_Invoke_mBA97A139BB64150729DCEAFA0B8E41471922979B','_HashFn_Invoke_mE061156CF34CD9EB568CED84561AF2E7D7B6D4D2','_HashFn_Invoke_m553A692840245E41A0E5A692CB80B12DC7B2A9F7','_HashFn_Invoke_mD763B387B2CE56FAF37B6B4113A450548933D318','_HashFn_Invoke_mA4C3DBEA1772314DDB40D2D78D4876F07FC2DE40','_HashFn_Invoke_mA1E457A05CC89480819F1633855B837087FA1259','_HashFn_Invoke_mCFA783D42199BBBE9DB3AE915D185EA0F1D33F77','_HashFn_Invoke_m6097F86E5D73930D2560AFEF6214555572738485','_HashFn_Invoke_mEAD6852E4A98A4D47D7C33785D0448CF530757CF','_HashFn_Invoke_m306703B8B2D363CE657F9B388D5F2BA1892D8D4E','_HashFn_Invoke_m1D3345903A35AEF3EA79F8AEFE182E8760368708','_HashFn_Invoke_m340D7FD64437A87ADFF3C8F6B577280AD8B0D88F','_HashFn_Invoke_m064BC1C6D9283D3114EA322CBE8744BEA235ABFD','_HashFn_Invoke_mC26465B6D99506BC3DDB86C0EE15008F719C28B3','_HashFn_Invoke_mD309BB90671E63BBEA84F6A3525B801E30C30E00','_HashFn_Invoke_m311EBDEA91457C4A9A3A1A6CF13776DAE454CFC6','_HashFn_Invoke_m8BCCBED65776DB5ECA773D696DE8173B142795AD','_HashFn_Invoke_m0494726EB88BB7AB4793BEA0AAA2AD3306DE296A','_HashFn_Invoke_mEB5C4095F079BB590C100D0BC4BD7C1A7E8750EB','_HashFn_Invoke_m74EFA9B038A18301AB78F13BDF223A36A91FA334','_HashFn_Invoke_m7D1DD060C107E5DB5C0B028F0806378F97526C7F','_HashFn_Invoke_m5E8E115E9E784460813DD7A0CA4522FB4224D872','_HashFn_Invoke_mE1412DAAEB140A03B1634259CEF2E271FC500172','_HashFn_Invoke_mEEDA831CEF3EA8EA5A6C117B2528A811BBF182D5','_HashFn_Invoke_m4F7879997DBCF537BDEAFF9FE260940A89124530','_HashFn_Invoke_m7BD9F70EFBE5C929A15B089313859E0895E33102','_HashFn_Invoke_mB5365DD4BE4C586B24C4416241B210B90F6273A9','_HashFn_Invoke_mDB3FA8CAA07BE76E229EECB717ED9EAF8F130AB4','_HashFn_Invoke_m9A5CCF656D7721BCA115E6BC2CC888DF9AAB2E64','_HashFn_Invoke_mC07DD070D5D6180CA1EE3A2DD5B86BF9C0DCE372','_HashFn_Invoke_mF3BFA20FEAD4C86947F1FCBDEAC66953C417DE2F','_HashFn_Invoke_m6735FBA82FB7D38CDBD6EFCB1C63DB2C82434CB8','_HashFn_Invoke_m9CF1DFEB9198637239368350BEAC779CE858D863','_HashFn_Invoke_m15713A247337653C594FEC8A5CDFA5CFFB38153E','_HashFn_Invoke_mEDF6DFFD9D1C49AF63BE27D18DA230F2E0752F07','_HashFn_Invoke_mAB8837C6D5321F605F20F62A11BB0CB211FDAF77','_HashFn_Invoke_m0306BBD5228C48937F6F482BA453F455FC4F492B','_HashFn_Invoke_mDFB4B2380F3515577BCF7608E287B6A3FB781FE2','_HashFn_Invoke_m4715BE2AC7926036AD4508FA5BD48F7FA7101E2C','_HashFn_Invoke_m1F83E4C1CCC838B0ACE05F9389F5DCCC2FBCC263','_HashFn_Invoke_mE5DE71E733667A6762D3068EFC03A4214564CE02','_HashFn_Invoke_mC3B49C3CF1DFBE5F8687CFAB61826E90533160D5','_HashFn_Invoke_m6EC23C969F30E5E0DD61F7E6B2CBC2E0BCA85A97','_HashFn_Invoke_mAED7889C8A438CB47EA334116DAB7A6406923E91','_HashFn_Invoke_mBAB4FB9183993AC3006FD5C3011B94308EBCA100','_HashFn_Invoke_mA9168CC1B296BC1800AF50DD3B7EAA4985BC9635','_HashFn_Invoke_mF5677C09E474E7C25CF2BD374CF0E34C07299A77','_HashFn_Invoke_mB0B49D776FE999D6C5206BE441C75FB67B3259C5','_HashFn_Invoke_mB3503ED616B82DB97F1E27B90D6334354F182E01','_HashFn_Invoke_mC48785749ADFD41E4DEB3FD65BE3E692DF626033','_HashFn_Invoke_m9C53149B4EA7379CCE021B3A81D814C333531AF7','_HashFn_Invoke_m570F03E6E7E4A3E64D55F65C79DA51E9EB9E9E3C','_HashFn_Invoke_m51F53148E7517182159BF6B4FA1EFF25C7E21EF5','_HashFn_Invoke_m038BB6BE75BE953EB822DBB1C2D3262E1DA3EBB0','_HashFn_Invoke_mF3E3DDA6180745FDAA67D2A4B07A5AB131401194','_HashFn_Invoke_m4C789DC2412B4D3DFFAB31647958784C0CCC3484','_HashFn_Invoke_mC18B9F584850F632921414D3DF940623721F4EA1','_HashFn_Invoke_mEC55E894829F5B0C932C929598DBF1285056EB36','_HashFn_Invoke_mCEA18AF08CA5C35C8CDDE4A2A4FD0090D2DDD09E','_HashFn_Invoke_mD9DCB10C9C22D2EAF9D70A0DCF36A49A7926EFCA','_HashFn_Invoke_m52BB60538C9F581945042C0203C1B480E9E75419','_HashFn_Invoke_m8ACB074870202664C26B281B43EE8A50EDCD0960','_HashFn_Invoke_m197E11279FD9442A3E9117015BE8B38BF5FD1DD9','_HashFn_Invoke_m46B4668F4BC006FF24B2C9784B5DE50602B6B7BF','_HashFn_Invoke_mA6B679D3E008C6EFC0AE376F4E5236E9F4B06AD9','_HashFn_Invoke_mAB7F77E2E005EC1B7DA22A232F701043543A776C','_HashFn_Invoke_m6FB5DA7CDB27FF20BFA1B7FBC22FD4194E3313F7','_HashFn_Invoke_mCAA37F6E4B7A952B8A4ED5FCEEFD776CA40C6E3B','_HashFn_Invoke_mC9B4A246B76F67D42E7F652AC6E264524CF72464','_HashFn_Invoke_mBD830F5D571C42473853642808F3393C8E62FAAB','_HashFn_Invoke_m838BD73F778020CBAA22811D554A1F6111DD827B','_HashFn_Invoke_m6EAA8119BF51393B4D76E068CC63F6BF367456D7','_HashFn_Invoke_mAB6E24E73D3339FDB8347EC50C7E84B7953AA0F6','_HashFn_Invoke_mA04FD80529C8524D8DF1CF0C3BFFFFFC6967C1DF','_HashFn_Invoke_m6F61EE5D625733F5F2BFFF00758EB8CF2383A66F','_HashFn_Invoke_mCFF9BA170B7A751DB6856462FF9E8A2E99A03471','_HashFn_Invoke_mF8C323B0FF27147A863348DAB16552DC0148821E','_HashFn_Invoke_m727FB43C186483C35BA726BBB277BA57FC8FF23A','_HashFn_Invoke_m5D229AD00502DE8074075E888B82BB3EB89040FB','_HashFn_Invoke_m01B62171D10A4BC7EEC6CC057874353723806F87','_HashFn_Invoke_m7AD1E6E28436C84A91CDFBDA24CDAC8530F204B2','_HashFn_Invoke_m5157D2A331CE18D54406943A9B221A8431E7014E','_HashFn_Invoke_mDC043A16A44C94A9320E068386D17936BF722C2B','_HashFn_Invoke_mC96489866FB5DDEF48B363428241D8AA599BD036','_HashFn_Invoke_mC9BDA421D60E4747DFD69EBE8F60A1B6BDB118BB','_HashFn_Invoke_m394201EFF3B205A2FBF6520D014B7283785195B4','_HashFn_Invoke_m885ADF3448A2D4225CDF96F94F27D0D03830874D','_HashFn_Invoke_mE4C3838CD85A83CC8E45119C3BBE9598805D4249','_HashFn_Invoke_mE7216B774BA4D10B02BAE9D68529A236D79A4DA3','_HashFn_Invoke_mE5C5D0EEB82EA7523F6B2DE396AC5FFBA4C6A2D5','_HashFn_Invoke_m05BBB51E7A94B8269A40CD3CD0AA1C7D554AA2ED','_HashFn_Invoke_mBF8F4740FE0A91E70906FF266BDF6C5CA7579A2B','_HashFn_Invoke_m5C50A104E8907B66783EEC70FD2D2298BB020593','_HashFn_Invoke_m87040A16D1034642580C8F94125CAB4F8FCF8757','_HashFn_Invoke_m1B905F1B4DCB170EEAEDA9B4AE94DED092491EB2','_AudioHTMLSystem_PlaySource_m2FD4CB8CBA144AFDC176A2392188B19D89DFE6BA','_AudioHTMLSystem_IsPlaying_m2EC1328FD69FE6BB46CED3D9C48D0C37CFAABF8B','_PointerID_Equals_m66F8A325D75BB73C8C22E033C77D271B9CA671B5_AdjustorThunk','_Scene_Equals_m5A9D7980272DF56C6EEF3653F6C792A366CB1FED_AdjustorThunk','_Scene_Equals_mFD3E665EEA4ACDA6F71AE1320818FBCA8567F377_AdjustorThunk','_Color_Equals_m4C5A8EA7AC9A63CA2381356C373B7323B3063D58_AdjustorThunk','_Color_Equals_m777EC098458C71F60C12A5C7EA2B33FAC1489FDA_AdjustorThunk','_ComponentTypeInArchetype_Equals_mA97A4D0BBF4EACC57235D94C097918E391A064EF_AdjustorThunk','_ArchetypeChunk_Equals_m8E615F54403FBCAE4EDD85C6FFBFF97F13749CA6_AdjustorThunk','_ArchetypeChunk_Equals_m0ACBDF10ACFABE86F7438A7E31CD4099F88CB08E_AdjustorThunk','_ComponentType_Equals_m168F52DA19E5EF3C145AFE532A456E6C6F50CC5A_AdjustorThunk','_ComponentType_Equals_mF42CECD5CE42A38F7AB31CDFF6C394853DFA683D_AdjustorThunk','_EntityArchetype_Equals_m3D069E0EA5EADFABB339F823E58A780E17EEFA59_AdjustorThunk','_EntityArchetype_Equals_mA7B36E3A76B5B3CA83C9B40F70B8BB8A07641497_AdjustorThunk','_NativeString512_Equals_mA01572B3A31E2742DBD59204E626F06B32B160CA_AdjustorThunk','_NativeString512_CompareTo_mE9463E2E10A18AB6EA26C0F8CAF518D917F4B3AB_AdjustorThunk','_NativeString512_Equals_m6E15970A02D1EEB80218F2285A4724D8E2EC012D_AdjustorThunk','_NativeArray_1_Equals_mCA39990550E55ED9F94CF68C1BAA3A53E6D047CE_AdjustorThunk','_NativeArray_1_Equals_m55B4FD3A01A3D40EDCA31AB342E53B1ACE4D3CFF_AdjustorThunk','_NativeArray_1_Equals_m258CDF651862B6963133AD70F8749983A10AD97B_AdjustorThunk','_NativeArray_1_Equals_m784D02B2C2D37680181536D1F3FC5F7000F43DD4_AdjustorThunk','_NativeArray_1_Equals_m611C308F97A5D23F2470BEE2680C94E00ED8250F_AdjustorThunk','_NativeArray_1_Equals_m6181398C00634FADFD700B782EB68641146C096E_AdjustorThunk','_NativeArray_1_Equals_mC12D88F2895D50E5E21C9F0E11DBD94FF023F59C_AdjustorThunk','_NativeArray_1_Equals_m760FDE99DAB760C9CF173A0CA0D341B9616B0A87_AdjustorThunk','_NativeArray_1_Equals_mFE1BAD0B92058FC143B5B67887B6DAA5C2E89FEF_AdjustorThunk','_NativeArray_1_Equals_m9521886DA78CF5AEB98092C994C9CF48A1183190_AdjustorThunk','_NativeArray_1_Equals_m404A6D5BD60C1D232FEFA51839056D5E48CF46D3_AdjustorThunk','_NativeArray_1_Equals_mDA937DE56A8C1E309206DC70D72ABE0619D8D64C_AdjustorThunk','_NativeArray_1_Equals_m953B636A875F18DB52C8FCF9B14E0C0F3D6257DA_AdjustorThunk','_NativeArray_1_Equals_m374382E87431BBED8AFA153F0E55748A9D6EB166_AdjustorThunk','_NativeArray_1_Equals_m83FA0F5C70F355AA8965797F8F13E960FC2DB225_AdjustorThunk','_NativeArray_1_Equals_mFD6E146B13D10069E00EAC8DF2A6A7A335216D48_AdjustorThunk','_NativeArray_1_Equals_m97BA170BF0FAE6609D4D517A048F7C09A79C58C6_AdjustorThunk','_NativeArray_1_Equals_m5342E68DF5FBCE38815A83CC62D89B7B547F3D41_AdjustorThunk','_NativeArray_1_Equals_m550824BA47BF564FEF35D9F342F9CB44B45290D7_AdjustorThunk','_NativeArray_1_Equals_m4398621EFFD4334B953E1E711887C71556006E5A_AdjustorThunk','_NativeArray_1_Equals_m5D66887DACA9B6906BEA4CED11F65500943C0E65_AdjustorThunk','_NativeArray_1_Equals_m6545ECED8B012731C120072525C672A18EA8F31A_AdjustorThunk','_NativeArray_1_Equals_m4BD685D0CED074C7CFED0FA12C4F9E9A912B31F6_AdjustorThunk','_NativeArray_1_Equals_m179C18063808C7E84EB977E9ED89393466CF6E24_AdjustorThunk','_NativeArray_1_Equals_mA283B6622774C6E080AE13F44B1C8A24D87E4A05_AdjustorThunk','_NativeArray_1_Equals_m32779352D96FE0A83F90AAF81405D1DEDD711314_AdjustorThunk','_NativeArray_1_Equals_mB28196E90F48C3EABD862D6377E549A96926DA2B_AdjustorThunk','_NativeArray_1_Equals_m51A80FC3433134D9FEFED2208AEDC189380EE54E_AdjustorThunk','_NativeArray_1_Equals_mF405BF42387B7BB3EFAE56BDDCB2EC636268AEDE_AdjustorThunk','_NativeArray_1_Equals_m370AF1795673F2CC2C58335A4B7848350442DA60_AdjustorThunk','_NativeArray_1_Equals_m1A0F63665FD681267F963787CB4A8698EE9F306F_AdjustorThunk','_NativeArray_1_Equals_m650331058667E207B44E47D0539CAB7614D260BC_AdjustorThunk','_NativeArray_1_Equals_m8E0C2E48DA387A06A83FFB5F6F272DED754EB4E2_AdjustorThunk','_NativeArray_1_Equals_mB4CB2DE86DBECC1706CE8A7211B0AB2A9A2603D8_AdjustorThunk','_NativeArray_1_Equals_m72F2BB8883AFC5F051643B7D23D58D7B14FA62A4_AdjustorThunk','_NativeArray_1_Equals_m95FED987F3FF0AB2BFDA06646D6EE604D8EB03E2_AdjustorThunk','_NativeArray_1_Equals_mBCED15E97650A127244DDD99D0372F166191E728_AdjustorThunk','_NativeArray_1_Equals_m5AFE7D0D5702E886F6BD0AA1FA4E9AE3D15C557C_AdjustorThunk','_NativeArray_1_Equals_m3AF406D76BE34F5655E07F5A88F77D62A76E29A3_AdjustorThunk','_NativeArray_1_Equals_m8DC5CB816911357EB3D9FCE414B4011B50F587B8_AdjustorThunk','_NativeArray_1_Equals_m432CF3E5516C60AC370E8AAFFA64306A69606D2B_AdjustorThunk','_NativeArray_1_Equals_m2B00E12C0244568E90A5F7C6A66E6F5A289121F7_AdjustorThunk','_NativeArray_1_Equals_m8A90D6C2D131BFA5D698E738344BB0BBBA194FFB_AdjustorThunk','_NativeArray_1_Equals_m22EED8F063C5AD3A9160922A32F6EC306DDD32C5_AdjustorThunk','_NativeArray_1_Equals_m812EA85DCAAA1FC2086F054F96C6DAA48CA26B05_AdjustorThunk','_NativeArray_1_Equals_m406B7EC10FE1A52BB152D7CB28AC8A788CE29A30_AdjustorThunk','_NativeArray_1_Equals_m38CCCC49E3DF92373E0270875EE7AB5438A7E246_AdjustorThunk','_NativeArray_1_Equals_m2AEE16E229E0B4CE49C034F6742BC17A36F72655_AdjustorThunk','_NativeArray_1_Equals_m4A4747B41E4D2555BF4B92E964F2D87C9147D658_AdjustorThunk','_NativeArray_1_Equals_m9014838A541D76BF8F5363D9040CB690B28A08B4_AdjustorThunk','_NativeArray_1_Equals_mA7E3276A59FD1A587C5F1E145D240B15F5A27343_AdjustorThunk','_NativeArray_1_Equals_m50A762D57042E0B8EB826BFB9C1EE3ADD43DA791_AdjustorThunk','_NativeArray_1_Equals_m536E772A78D627C43F6AC516831F4D4FF507AACE_AdjustorThunk','_NativeArray_1_Equals_mB97B7F7E7EA5F00F8C5646609459AD73C551F418_AdjustorThunk','_NativeArray_1_Equals_m9DA5AB6085918A9F6E15B4AB99F41A5E79CC68B8_AdjustorThunk','_NativeArray_1_Equals_m219D199FE96B620E4741BF28D9C239ACAF9492F8_AdjustorThunk','_NativeArray_1_Equals_mCB3F7317392F55C498BFFCF27E7CB7224E0A2320_AdjustorThunk','_NativeArray_1_Equals_m5EE817E7264C931961EFB068CB10AA0B7CC93F83_AdjustorThunk','_NativeArray_1_Equals_m60639DEE6830EDB72E35429D18DC3B50EC9A46A8_AdjustorThunk','_NativeArray_1_Equals_m9D4D18BEE689D11F970FFE2066F30564CAA9BEEF_AdjustorThunk','_NativeArray_1_Equals_mC06AE6F0F6FEED320A313B24F50CAE7B79815B47_AdjustorThunk','_NativeArray_1_Equals_m7A23448B44A537AA32BC12D53CCCB90BD468B6A4_AdjustorThunk','_NativeArray_1_Equals_m392E8D1C97DAADB01ABFFBDE33F69A107A0D6684_AdjustorThunk','_NativeArray_1_Equals_mAC9BEEEC3F242DCB1F9A968DFE8F2DA3E5FE42F7_AdjustorThunk','_NativeArray_1_Equals_mB3549C13D3F70847E5C693ECC3E783FA4199BE84_AdjustorThunk','_NativeArray_1_Equals_mCF758F1D1F80B66E191CCA97487EDF068A8443B2_AdjustorThunk','_NativeArray_1_Equals_mB77934E3F13A547BA421D5D8969D4359FF15ED93_AdjustorThunk','_NativeArray_1_Equals_mD4C3F830A2CB1F5F6A52EEA8B031FE08951C11DF_AdjustorThunk','_NativeArray_1_Equals_mE6F28203790FF2CEBE30218C81D97D16E5AAE688_AdjustorThunk','_NativeArray_1_Equals_m0B4416A3B407FF3C9EF8BF5D22EBAE09DE8352CD_AdjustorThunk','_NativeArray_1_Equals_m29673EE059A6D33D28CFD608FC89B2371CD7B4EE_AdjustorThunk','_NativeArray_1_Equals_m827DEDDDB076781E23F05EE7FAD8FC1BFF844326_AdjustorThunk','_NativeArray_1_Equals_mB6C9E9FA392E1947601845CAEDD2B8C0E1120F44_AdjustorThunk','_NativeArray_1_Equals_m6751CC5A18C0C064CCD86CDBB173ACAC6A38998A_AdjustorThunk','_NativeArray_1_Equals_mB380E8D051C81491EB8EF4661763D93E3B4151DF_AdjustorThunk','_NativeArray_1_Equals_mCB2DB950FD94E4DF1BAD7B82B6E4846ECA02D5E5_AdjustorThunk','_NativeArray_1_Equals_m5781AE3BD3E40A009706DD342A3416B95E2B3085_AdjustorThunk','_NativeArray_1_Equals_m22703F471031421E78F70167D43C45CD37476F3D_AdjustorThunk','_NativeArray_1_Equals_m1AFF3C0C7DD87F2C4243FC6C15F6A3A97D255606_AdjustorThunk','_NativeArray_1_Equals_mF549F76371CF4BD384254751A25BE5A952137E08_AdjustorThunk','_NativeArray_1_Equals_m839F6099716C39EA91BCFBF52B989DAE8BBD917B_AdjustorThunk','_NativeArray_1_Equals_m6AD85A69D401DE007540C2D4500553E7DE075863_AdjustorThunk','_NativeArray_1_Equals_m8D0CF4D8B21A4E183DD3E905360402E9FA915622_AdjustorThunk','_NativeArray_1_Equals_m74B58858C05091EBDC6FEFC543618F2F0E8E0A1F_AdjustorThunk','_NativeArray_1_Equals_mBA538D7C9A506A40E288D29DA64B3A93E0A83153_AdjustorThunk','_NativeArray_1_Equals_m8CF426DED6C95AAF26976F4482D56368AB5DF596_AdjustorThunk','_NativeArray_1_Equals_m40D1703CC2C237ACECE562A13B37C2AEF45FA4D0_AdjustorThunk','_NativeArray_1_Equals_mE0DA491E5A492238711E1734CDBCE7ED573AEC68_AdjustorThunk','_NativeArray_1_Equals_m30D0FE95FA3FB353B5C5DCCDCC6B0241729B8AA5_AdjustorThunk','_NativeArray_1_Equals_m54F231C3CB650B9A865681EB8811B18EF2EE9F08_AdjustorThunk','_NativeArray_1_Equals_m8E211372B41FAC17AD033E164C77CA8C885AEFBE_AdjustorThunk','_NativeArray_1_Equals_m9D020743170AF35B220E4E3B77ECA6D6E1F4352E_AdjustorThunk','_NativeArray_1_Equals_mF1D6AF6494CB8E47D0B1D6A096A34748FAC04FB8_AdjustorThunk','_NativeArray_1_Equals_m3EAB926C9881D43C01A8E4FD5E2AD222A84EBDEB_AdjustorThunk','_NativeArray_1_Equals_m66BC26933E0622F77312757C33B55A742457FA94_AdjustorThunk','_NativeArray_1_Equals_m61A90877405934759FC9C6798267B4C16E4DD69F_AdjustorThunk','_NativeArray_1_Equals_m9DA06A8892DF8634F30A43C3A63B42F18C126B60_AdjustorThunk','_NativeArray_1_Equals_m18C42685836B1EF88B51E8123F06451A0BBBA055_AdjustorThunk','_NativeArray_1_Equals_m7EB4CFCC6DD71FB4F3D6135ADC5FFF48D08F117B_AdjustorThunk','_NativeArray_1_Equals_mB35DB4C7E90924BA7F19595663D349454F8075DA_AdjustorThunk','_NativeArray_1_Equals_m75B8DE8A8D235A7BB92AF223AFE1010C946A70C3_AdjustorThunk','_NativeArray_1_Equals_m9174B8B53F78CE1336ADF8D73E4835B5B84E92FA_AdjustorThunk','_NativeArray_1_Equals_m953A4E032692556779657B674F0B1AFCB6E917C0_AdjustorThunk','_NativeArray_1_Equals_m7FFABF90FD8633244714F013073D3CD50221F103_AdjustorThunk','_NativeArray_1_Equals_mEEB5BC3580B9D53C8F12C83AC4FCDF3F1DA479D4_AdjustorThunk','_NativeArray_1_Equals_m00554D8E0494B47E1D5C647060C8A99ABE39AFAC_AdjustorThunk','_NativeArray_1_Equals_mDB52D6A6F9EB9B38F23C05FB9C48A3A69F28F8FA_AdjustorThunk','_NativeArray_1_Equals_m8BC36ABB0008071AACD21E3D5E46C172684111E5_AdjustorThunk','_NativeArray_1_Equals_m7FA0F52BB1C9B41DB7BAC277B87AF3F57A7FFC33_AdjustorThunk','_NativeArray_1_Equals_m8D0C66B66540DF1E6C7D8BD87F3B2F4B8F7B03A0_AdjustorThunk','_NativeArray_1_Equals_m9A41284A59705040487A447D6400997AFA3F4542_AdjustorThunk','_NativeArray_1_Equals_m9D5078FA0AE1ADFDF8C1A8AF00F007D08D50D158_AdjustorThunk','_NativeArray_1_Equals_m555288A8C190F0EF09654AC18B29982FB79A529D_AdjustorThunk','_NativeArray_1_Equals_m56AEB99859B205014E4871550321D820DC553799_AdjustorThunk','_NativeArray_1_Equals_m6093AEDF8703D9FC6CB82F2F6433BAD68FB7AA59_AdjustorThunk','_NativeArray_1_Equals_m6B129DDDE61E1D1C8A626F6A973A0FEA5681C8D0_AdjustorThunk','_NativeArray_1_Equals_m55A8940473D4F4C00F19DCBA146644AA5F01F011_AdjustorThunk','_NativeArray_1_Equals_mEE3DC8C4F90416AB4A7999CD0AC92ED369C0A538_AdjustorThunk','_NativeArray_1_Equals_mF83A4D5DC7C6F90639FE335AFE57970062F13DB0_AdjustorThunk','_NativeArray_1_Equals_m728923893005EE15889B9D0E1EAD4C420D334B55_AdjustorThunk','_NativeArray_1_Equals_m2A78A1D756E5EED70F4AB16A40D487F511B7414C_AdjustorThunk','_NativeArray_1_Equals_m9356E2B9966D26BCF2B75BD4B8E28DD889B302DA_AdjustorThunk','_NativeArray_1_Equals_mFCA794C31F8EDC7AA1EF62F934DC125E5F956581_AdjustorThunk','_NativeArray_1_Equals_m2A3E088C41829E6A29BB8B65B8E11AF7075917CC_AdjustorThunk','_NativeArray_1_Equals_mE1A139299E95926934A4C71560C0ED8FA5F1E027_AdjustorThunk','_NativeArray_1_Equals_m4A1257C80CFD00E1DCAFD02C47572C6D91BB02F5_AdjustorThunk','_NativeArray_1_Equals_m6E9A6C09C1A5B8ACDDBDC74AF4A274E8877B8FE9_AdjustorThunk','_NativeArray_1_Equals_m4CFAD1373D0539A5D40C8E38B1C3C3AE0751C6A8_AdjustorThunk','_NativeArray_1_Equals_mED59A07F2FB8A86242587B0A05168ECFE2058331_AdjustorThunk','_NativeArray_1_Equals_mB78143AB5635C503FE0441BF4C01828A90450AD3_AdjustorThunk','_NativeArray_1_Equals_mBE295C2838B4FA142AFBEFAF5A94E4595D047ECB_AdjustorThunk','_NativeArray_1_Equals_m51F6CCF860DE74D69AC1E6922AA5FF50FDB898E4_AdjustorThunk','_NativeArray_1_Equals_mB89E57012F8D81CE805A3F60ED22A15226950C1F_AdjustorThunk','_NativeArray_1_Equals_mA214FB12FB768FE6A6B6C7B00BE65547E41ED764_AdjustorThunk','_NativeArray_1_Equals_m84C454AFAA4E213C00326525EFCBC74E86AEDC95_AdjustorThunk','_NativeArray_1_Equals_m54209CD86983D9225A9EE4D3611364C0E1B68EA9_AdjustorThunk','_NativeArray_1_Equals_mFD707980DA9C79D32D2AAB318D6D3F459D83005C_AdjustorThunk','_NativeArray_1_Equals_mB2D6ED47B73ADC71ED07DFF7DF07464040BA4E56_AdjustorThunk','_NativeArray_1_Equals_mBAED003F90389A347AB396813BB41B9EC34AB6EF_AdjustorThunk','_NativeArray_1_Equals_m2A8655EC6D66AC0358F716D7F787FE02CBEA4805_AdjustorThunk','_NativeArray_1_Equals_m4CB5DDE429FDBD64BB816D7185BBEE5005FB6FB0_AdjustorThunk','_NativeArray_1_Equals_m179657F5E08115B4B7FEC64A3888BE599B0E0CDD_AdjustorThunk','_NativeArray_1_Equals_m836CF3748B60B96296C546E0915133EF74E376FE_AdjustorThunk','_NativeArray_1_Equals_m6FA8ADBCEA77890B3DACD6A02B0D1358BDAFEC70_AdjustorThunk','_NativeArray_1_Equals_m3898CA3C8AF529A7C4F3E115C751E6F2CA4867AB_AdjustorThunk','_NativeArray_1_Equals_mAD83B15FC98FA982D8DE5E323ACC4F00D9C693E1_AdjustorThunk','_NativeArray_1_Equals_m3DC4E1A22E7C3ACFCEC8A9A67D5CC2F159C82A1C_AdjustorThunk','_NativeArray_1_Equals_m615112EFAF88AE1A0D7CD1EBD228A6B72A3595FE_AdjustorThunk','_NativeArray_1_Equals_m53E9D24989B4D1285A23BEA6D09C86E1F825BB29_AdjustorThunk','_NativeArray_1_Equals_mE9247B32853A6E722A7E44714AC7F28F054E31CB_AdjustorThunk','_NativeArray_1_Equals_m2BF458A4709A6238C3003EE02C4CD6785829FDCA_AdjustorThunk','_NativeArray_1_Equals_m6D673E4FFA76C2507A968232CB65C040590F8BCF_AdjustorThunk','_NativeArray_1_Equals_mE82FC7B99ED17E149B845E8E45373A101FCF2277_AdjustorThunk','_NativeArray_1_Equals_m02F0C25BF882191B100B0DFEC2E009C4B8EF688F_AdjustorThunk','_NativeArray_1_Equals_m820C366F1DAF0F1CD42457ABCC204F2C48AB4985_AdjustorThunk','_NativeArray_1_Equals_m7CDB39322E730F0CC33D5E91A4B1BD94048229F4_AdjustorThunk','_NativeArray_1_Equals_mABA556D526D78BB3A219BFACFA54B41C82004BE9_AdjustorThunk','_NativeArray_1_Equals_m2891BB78448EB7B04A7B35F078829F6A88636A3A_AdjustorThunk','_NativeArray_1_Equals_m684F2CA0CCD86BF98CF7E41D85E6B18BD3E381E1_AdjustorThunk','_NativeArray_1_Equals_mED18FE7B569C77494F323C8773F7292D6323BE4E_AdjustorThunk','_NativeArray_1_Equals_m9C953D9AF6D41704644AC507A5DB8B6A85D2D1F4_AdjustorThunk','_NativeArray_1_Equals_m9CAB181F3C80ACBB60360F14A635B4C1E99ABDF0_AdjustorThunk','_NativeArray_1_Equals_m0D83B19B6DA3B2EFF7F8D0E3B9BD33B2779CECA2_AdjustorThunk','_NativeArray_1_Equals_m4BF71CB90F5420967B339FA7C460D6F7E944B887_AdjustorThunk','_NativeArray_1_Equals_m99833E21EA4378A04F4332ED16A0FFCB50493667_AdjustorThunk','_NativeArray_1_Equals_m3425025A6D417D560E6A5CC4A8E4EFAEF1E1032A_AdjustorThunk','_NativeArray_1_Equals_mF32EC7BE7E24635987B8BFF021B3A9F9289B94A3_AdjustorThunk','_NativeArray_1_Equals_mAF2645712F28FF461BB21B3B749EF918B7411A61_AdjustorThunk','_NativeArray_1_Equals_mE16E5DEE9B580C47C60BE38D8EA06A8BB6379F6B_AdjustorThunk','_NativeArray_1_Equals_mFB59CF83FFD7C14E51FCDD70EFF7E26CFA1A71FA_AdjustorThunk','_NativeSlice_1_Equals_m3AECE8E9023C60599B00DAB5BC93808F8FDE7126_AdjustorThunk','_NativeSlice_1_Equals_m3575082C60D32CC2E1471DC124C10A6FA8CE77D1_AdjustorThunk','_StaticTypeRegistry_DoEquals_m3741A15463E1BCBB9010BEFCFE904E0022350387','_StaticTypeRegistry_DoEquals_mE08051C7E57EDA0F3B51034DE6DBD775A417674F','_StaticTypeRegistry_DoEquals_m3E27747C08A360313457B45213803F1403321488','_StaticTypeRegistry_DoEquals_m658C8FFD9B3267A13963FD3D373BFF50E735CB8C','_StaticTypeRegistry_DoEquals_m1C247E415263F2216F329E953FFBB8130A69A1E5','_StaticTypeRegistry_DoEquals_mE488A6DFC7FE7D2BFEC873076CCC859FDCEB0E1E','_StaticTypeRegistry_DoEquals_m3E3D7DCE2B785B7C7A355054DECD5C2E2FF9D586','_StaticTypeRegistry_DoEquals_m4CDC9E7F149E7999B88DCE6A901C61CA0FD7E635','_StaticTypeRegistry_DoEquals_m06E662819E487B6FEFA85B449D534ACB62870D72','_StaticTypeRegistry_DoEquals_m7181A93DC290F57FDE566627634E84E213D421E1','_StaticTypeRegistry_DoEquals_mF928EFDDAC61C26C708FA07AC2D7491064005CA0','_StaticTypeRegistry_DoEquals_m2E973B28E568759EFD836BFE85957750B17FE243','_StaticTypeRegistry_DoEquals_m7B715983B651F4D49DDFBDA8579DECA321ED3ADD','_StaticTypeRegistry_DoEquals_m57FD82260822D7ECAC3648454449F40C049F9294','_StaticTypeRegistry_DoEquals_mAF9F667A9B5C1CA42BEE7FD09D18A01C31267280','_StaticTypeRegistry_DoEquals_m466AA5704961F0DBA6BE27D755CA4FCAF8811E37','_StaticTypeRegistry_DoEquals_m84BD6B0F44AB2BA5E763E3F1A124FE27E4414AE8','_StaticTypeRegistry_DoEquals_m3C792E56067ED5E9F5B642AF861D2849A3438BF6','_StaticTypeRegistry_DoEquals_m159370C1905E7046D9D2C59EE865AEB08C9A72EA','_StaticTypeRegistry_DoEquals_m08D7C77C0A94C0485422565A9CB89D039DBE08C6','_StaticTypeRegistry_DoEquals_mF12BCD74270322C112E740E197399EE68F7678F5','_StaticTypeRegistry_DoEquals_m10C987F0E0315584A640C5578EE3871FBA6C97A8','_StaticTypeRegistry_DoEquals_m3FA6F0132435DC425ABB9B5B67C1D5CA2878417A','_StaticTypeRegistry_DoEquals_m4613B6193E8ECE8774D7AB67FF953747585CE53D','_StaticTypeRegistry_DoEquals_m0EB7C11A64D2F64EB04ED17C222F05A6675070B2','_StaticTypeRegistry_DoEquals_mA5E5021149FCC95F306C512C98BFF3DDBC7BA8D6','_StaticTypeRegistry_DoEquals_m23D9B3FC611A37F757F92C09142A9107371934EB','_StaticTypeRegistry_DoEquals_m610D1A7469C2D6C44FA7BAFCA3C69E03583285E4','_StaticTypeRegistry_DoEquals_m90CF1416BBB19600F2310280D71CB8A8F44D846B','_StaticTypeRegistry_DoEquals_m75AB2AC12118DC4032E96ECD92E667DD2C1B6D2C','_StaticTypeRegistry_DoEquals_mF156EA779F27CD2D43A5E1B5545AAA4C70DC82B0','_StaticTypeRegistry_DoEquals_m296551E3003725B0D5B43D3B0E1DC0655A94B0F4','_StaticTypeRegistry_DoEquals_m85906E49D825CD9CF17D9B3ACE39009F1AFABEBF','_StaticTypeRegistry_DoEquals_mD4A5B05F0B39173D1549DAA21B0E8DBCEE91FF5B','_StaticTypeRegistry_DoEquals_m1EBD1DB6F471FA2AD2A57DA490D83A2C47867CA6','_StaticTypeRegistry_DoEquals_m10535A311B95A9D012AE2E44A16D6BD48E3921DC','_StaticTypeRegistry_DoEquals_mA70E5FF830ABEAED23D0ACA569F620F32828DFB4','_StaticTypeRegistry_DoEquals_m08F2D7AAEC402E4080997F48ED62CC1C5CE56019','_StaticTypeRegistry_DoEquals_mBAA82397C716B37A4B71DEC2B917409836AFF7E2','_StaticTypeRegistry_DoEquals_m9DC5C781C22B188949370463C4C728649B9AC024','_StaticTypeRegistry_DoEquals_m8B196B78E7701B98A1481EB6957AC6A3DE9D8C5D','_StaticTypeRegistry_DoEquals_m9967B09507D64A8594E1F605BAD896060FEF9ECF','_StaticTypeRegistry_DoEquals_mFDFB8CA7EA57DCB439648A6AFAE81BEC4EB1CA47','_StaticTypeRegistry_DoEquals_m1ED427A377D7E05888026B91329AEB5C8A851E24','_StaticTypeRegistry_DoEquals_mC24242B493562A25D36B6EF130864BAA3BA6C8D1','_StaticTypeRegistry_DoEquals_m46DB345DD10E34F27A86FF7EEDB32C2AA6AFF642','_StaticTypeRegistry_DoEquals_m6EC988C69AC4B394CFBBE33E7686D58353020C91','_StaticTypeRegistry_DoEquals_m10C6FAC864879E573D2403D780450935F2EEA6B7','_StaticTypeRegistry_DoEquals_mDF988D1A0C5A2AA013B94158541CA166753C051A','_StaticTypeRegistry_DoEquals_m6B0B2CB5D0B4F1B7D96E31518D1FE3D9409F4788','_StaticTypeRegistry_DoEquals_mE5C0675782B0B25E95068EDBD507DCAE222AD5EB','_StaticTypeRegistry_DoEquals_m3AB32F7170D8F10D860139D75E14E60D6BD3D8A5','_StaticTypeRegistry_DoEquals_mCB00D4C5AC3245C7D01D563F97C913C56C7CAC54','_StaticTypeRegistry_DoEquals_m8A65F63472033F4F801DA1A7C5452B2743CE2131','_StaticTypeRegistry_DoEquals_m1DC9F753B45DE0E723BAFF9D6C5CCC5B0BF144F8','_StaticTypeRegistry_DoEquals_m6E00BEFDF60205DE4140AD40C9D5B0F050B707BE','_StaticTypeRegistry_DoEquals_mFA97EEBCC2A769089130700268A285C0D0743FB7','_StaticTypeRegistry_DoEquals_m74AF75D40B85F1A9B33E3DF3BE7083B422E0D866','_StaticTypeRegistry_DoEquals_m71DD8D3D728763BB7BDA2994A13C738BAA040ABE','_StaticTypeRegistry_DoEquals_m102791A2752349DCC7CA56724166E3116CE01920','_StaticTypeRegistry_DoEquals_m6B730F4407AD03D6A3E606F4F4BE5D46600F60A2','_StaticTypeRegistry_DoEquals_mE4FFBFB277A3B1B9453935EFE5D4C5B253D2E3B6','_StaticTypeRegistry_DoEquals_m563D5325D09FB627854F0AA771B085D27AE7851A','_StaticTypeRegistry_DoEquals_mA9CE8A8230531A344A3B02EAACC08B31C511875B','_StaticTypeRegistry_DoEquals_m459C3333CFCFFA9B8B1D7DF43FCC96DBB377E1BA','_StaticTypeRegistry_DoEquals_m0CE6859DB7A5100AA2714849A8552774796C3D16','_StaticTypeRegistry_DoEquals_mC06F5708A3B4254A7AEC3E2657FB5DADED9A67FD','_StaticTypeRegistry_DoEquals_m3515CDE27747FEB7CB4344A3FE9363241B8BB18C','_StaticTypeRegistry_DoEquals_m464C873E1CBA911CD51428BA6CFD2D1337F7D1D4','_StaticTypeRegistry_DoEquals_m6D7FB6BDC014F90788725523E5476050EBD9F91B','_StaticTypeRegistry_DoEquals_mAEE10A0E72B1E07E758CCA6E93F062CD16D774CE','_StaticTypeRegistry_DoEquals_mEC8253A38947B03C2763A53B13C7787C3182C6AE','_StaticTypeRegistry_DoEquals_mAE5D4881DF9C676E396594E19570263EDECD79F0','_StaticTypeRegistry_DoEquals_m39885D0491E4F46A3B174F205DBA2B46CA98A881','_StaticTypeRegistry_DoEquals_m333BA35B38A2333528CE00DBA62E2BFC7175208B','_StaticTypeRegistry_DoEquals_m7AEA798A558185A27B64C5D0DDEF770D82A14B53','_StaticTypeRegistry_DoEquals_m86A9DC31186DC9AB740660BFC8916CB2E6E0314A','_StaticTypeRegistry_DoEquals_m972B999CE8B8FAA7C00408DF106E88C735635E8C','_StaticTypeRegistry_DoEquals_m5E84062346429077868086B86121A279356C954B','_StaticTypeRegistry_DoEquals_mBA9866DC46333EB1AD8CEC5F059B521F8B08353A','_StaticTypeRegistry_DoEquals_m86EDA78E3EDFE96875A0AD1487800E6E6DF39FB8','_StaticTypeRegistry_DoEquals_mD012013E0616D414282C42EDAC2BCAD52369A59E','_StaticTypeRegistry_DoEquals_m43D09A040C7B58CFA87D4C6F2C833D6B2691A437','_StaticTypeRegistry_DoEquals_mCE18B002631627993ACBE668B9227B71D23AA9DA','_StaticTypeRegistry_DoEquals_m622D984EDE56FBDFC98D7F6C7DBA37428B013931','_StaticTypeRegistry_DoEquals_m9778016F8BD1EAB09783A47FEA048C2A4F2683A8','_StaticTypeRegistry_DoEquals_m2CA51FA94312DAF56B3E117616BE84C3361BF083','_StaticTypeRegistry_DoEquals_mEF26CC7A49BEDF7AEB7A84D451C4BA2E0CC958AF','_StaticTypeRegistry_DoEquals_mB29C58D2EC43F00D6EE75581C4719C5F74E748EA','_StaticTypeRegistry_DoEquals_m6455B5885FA5610BFA3F6CC5A12BE784D0E161A6','_StaticTypeRegistry_DoEquals_mB7A350322841C30E7A2394B6D002AF34099F0797','_StaticTypeRegistry_DoEquals_m0A71F36BF3106F3251F365AB9A7406B9A4F2BD17','_StaticTypeRegistry_DoEquals_m0474AFC02CA2BDA7698B8020AA5CC275BA4D9795','_StaticTypeRegistry_DoEquals_m502A012469F14A01F37913384A44D2FF2AF820E6','_StaticTypeRegistry_DoEquals_mCE487C5E72C7E29D6DBC0BAE04EA296CDE3B7944','_StaticTypeRegistry_DoEquals_m9DCE1741FAB7494DAFD68744CCAAC6BBB3620C97','_StaticTypeRegistry_DoEquals_m14B999BD227C805A68C9667F9BC426CBCFE4FA2D','_StaticTypeRegistry_DoEquals_m521860DD8C77E6FE3186DB7EFDEFA97387B71E0B','_StaticTypeRegistry_DoEquals_mFEB00EC23BD61E66081DA2839BF5E5FD9280AD74','_StaticTypeRegistry_DoEquals_m4B740A6395C7C9D95486BB143308E240115C7069','_StaticTypeRegistry_DoEquals_m0B7E16610DC68EC23BF31A40FA8F9CC9FCBE4C7F','_StaticTypeRegistry_DoEquals_m447F31A8DF829156F76D5FC6D6E01BC13725C4AB','_StaticTypeRegistry_DoEquals_m604942E8F5F54FB003BE3A2FEA4CC34BBDC05117','_StaticTypeRegistry_DoEquals_m45DA26EE812273FF2C4D844602BB992E3D273719','_StaticTypeRegistry_DoEquals_mD22F6F2D8A5F8105A3CDDA8FCE009B1C9682EF72','_StaticTypeRegistry_DoEquals_m7614E8F59740FC82734F83B12C327718244B12BE','_StaticTypeRegistry_DoEquals_mDDD65CE300CEA078475637013A8F660A2A850B17','_StaticTypeRegistry_DoEquals_m90E1450FA856E7549817FEC0D55CE5D226F51497','_StaticTypeRegistry_DoEquals_mA4EA77C1327C86475C044254622455CF12707B01','_StaticTypeRegistry_DoEquals_m5D355C6BB28F8EF254E1359AA6891741503817E1','_StaticTypeRegistry_DoEquals_m1F32A7BA7A457850ECA970C644C6B1430B795A62','_StaticTypeRegistry_DoEquals_m6438DC5CC0FE312C8DA45167DA7DF5FC3F06E4EF','_StaticTypeRegistry_DoEquals_m9F574F3AF642BF47619A35F04D535CDC764879F5','_StaticTypeRegistry_DoEquals_mB8B3F9DE5B356FC4C6099CC746A6488E7DAF99B7','_StaticTypeRegistry_DoEquals_mF27AB7D62002E5B4075A8D527067F2C10570D0F4','_StaticTypeRegistry_DoEquals_m09B410C5E8094AD138EB86B7D24BE9BB2E8AC635','_StaticTypeRegistry_DoEquals_mA13E5115BED333AC401AF51F3ACB79272E9F4558','_StaticTypeRegistry_DoEquals_mC2533226644D0F405BDE07E46B1DC60DB64A8495','_StaticTypeRegistry_DoEquals_mB755508F8430B122001DA9EE0011E19A63A6B4CE','_StaticTypeRegistry_DoEquals_m052F6C8440A47195DEC691F38742E0F881BDE963','_StaticTypeRegistry_DoEquals_m9400D61F179DF09716EB74D0E461FAF90E13B8EF','_StaticTypeRegistry_DoEquals_m4E755D672FACC92A7771E479C9C5494EC4406E79','_StaticTypeRegistry_DoEquals_m31E2111D10EB1F320F8B45FE444457C698FF514E','_StaticTypeRegistry_DoEquals_m28A8EDFD02A7A86824D10229ED91E4AB6880DAF8','_StaticTypeRegistry_DoEquals_m2A61E198E6ADAAE64F867D0B5C6179AB1F69D60C','_StaticTypeRegistry_DoEquals_m74897EB53F06D6B11E66CE73BEE29E2D75073F60','_StaticTypeRegistry_DoEquals_m632A096A6D32AB4B0B837ADC65FC2E567C6087C0','_StaticTypeRegistry_DoEquals_m9522084CFA6C11D62F925D0E77E7DF76783FA90D','_StaticTypeRegistry_DoEquals_m38CB1FAB0CA43D9A88D9660D554B1CEDC2EC25CD','_StaticTypeRegistry_DoEquals_mDF2A49573B3AD1A29EF3166C74BDAC70EAEBCCF3','_StaticTypeRegistry_DoEquals_m2C7AF45264114A3E30E26C4AD2FC527BD85FFF38','_StaticTypeRegistry_DoEquals_m5F9CD72795AE06F8B70C79ECECA7B3F38F2D2C89','_StaticTypeRegistry_DoEquals_mE989F43FC9BA7BEAB2F6698CD36E502CFB63AF6D','_StaticTypeRegistry_DoEquals_m65092FA4E185BA5CE661E0C007EA93B90F46DA2C','_StaticTypeRegistry_DoEquals_m39971AB8E6BAE84B1586674A42C3F704549D795D','_StaticTypeRegistry_DoEquals_mD6C76D9FEF698C973D8DAF659797BB9C4153B5B3','_StaticTypeRegistry_DoEquals_m24DCD238E4177ED9286EE7CCF1C9EFA6DF1ABD71','_StaticTypeRegistry_DoEquals_m748FAF6D7AE10A47F5BA01ECB3AE52E0F3024902','_StaticTypeRegistry_DoEquals_mB08ACF2605FCA225DCFE8AF31BF2651C1015FD00','_StaticTypeRegistry_DoEquals_m1DAB4BC77086A95EFBC399C80A8914FB8B814E9E','_StaticTypeRegistry_DoEquals_m6345B6DA05BA54686A3A5D87BEEDD7D8B86FD138','_StaticTypeRegistry_DoEquals_mAA6F1007F6E7275DDEDAC7A9A4C1B62B4671DC8B','_StaticTypeRegistry_DoEquals_m8AE1098FC4454934417B615D0AF427BD8403AF7C',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iiii = [0,'_Guid_ToString_m1E9A741BB3499BA4985E5D148FA8A82426281899_AdjustorThunk','_EqualsFn_Invoke_mD2201BB8E83A11D251FAEC418A6ACCCE8B70A89A','_EqualsFn_Invoke_mFE4F33D6D941A3DBAA939587AC9F363A08F077D7','_EqualsFn_Invoke_mFBF32E25157FEB547374439B9796261CF6D82B9F','_EqualsFn_Invoke_m3743E35C364923D75CD5A8D866EBD57A2361AF8E','_EqualsFn_Invoke_m8AC3CBE888CD68F182493B7EB07A567832D69435','_EqualsFn_Invoke_m73BD3D6B31E2234B0BEE530C03E867A8464D2B76','_EqualsFn_Invoke_mA2F837FEFAC5C522BEB9C2E37135E3A92EBCE6D0','_EqualsFn_Invoke_m36132F3BA10DB3E67E19C7D6A3BC05FE8596D6D4','_EqualsFn_Invoke_mE2EE7F82A535D4F7C3049425BDBFD415EA41721E','_EqualsFn_Invoke_m7BA8AC6BD032A75DA937EF80BA241D5FA2898A28','_EqualsFn_Invoke_m7AC8569CF80146A7FA941FE7D61BCFF1CC08C050','_EqualsFn_Invoke_mD8C8D44B1D28F3E48FB50833486AFEC74F33B309','_EqualsFn_Invoke_m3F1E08685FE8C312D6010B1ACDAEED8E14A249CF','_EqualsFn_Invoke_m5DCB307323B289050AD4E7A467F5728D03A9F716','_EqualsFn_Invoke_m7C71D0BC04FC36EEB7BCC3ACF7244C67E76EEF0D','_EqualsFn_Invoke_m7B700466DA20FDD23E17DAE8F9748B222005E0D9','_EqualsFn_Invoke_m50606C9B08197052AD8CE4EAA692F80C74A513E3','_EqualsFn_Invoke_m074A1790CE9916AF9FF0F2D5473182DBB81BE250','_EqualsFn_Invoke_m49066C6AAA86FC0CE40A90901023557B7985608D','_EqualsFn_Invoke_m0963153ED8364C7BB4E771464B2583CD7267A258','_EqualsFn_Invoke_mA23F0D1E0813BA2A6238B510305A654D7A2D3BB7','_EqualsFn_Invoke_mFB9257EFF1F55D8979D385012DEDA37F15A6BB10','_EqualsFn_Invoke_m77649468770690C4B56010E16D7456290FFE2E9A','_EqualsFn_Invoke_m7B78AEDFC3F67143E8B122B4366365C81F75E3BC','_EqualsFn_Invoke_m721806FBC36297D893481C2E067DFC12FBA494AE','_EqualsFn_Invoke_m820873E1F7790141EE01E3CC975476AED986AF45','_EqualsFn_Invoke_m32AFC0D2FF4CDB5843FC29FA8A24C509778C00C4','_EqualsFn_Invoke_mBF82A0E9384B5A8B457BC6ACE3E2BCB1D86D58F8','_EqualsFn_Invoke_m1E0CE83D460255AF6C57C8396686A7FBA2F6099F','_EqualsFn_Invoke_m4EEA6C4E1481739E51F20B39654126C9BE69D5A2','_EqualsFn_Invoke_mD4C972CEAE35B2B429BD4FD63D40D0A83D868D5D','_EqualsFn_Invoke_m6B091CADEDE4FF7B195CB447BE3C2693B742F9F4','_EqualsFn_Invoke_mB36CD441EF4A7EA01B3E086E00308F556131103C','_EqualsFn_Invoke_m59B7E4764C95D9DF0528AB7F4DCB42E869BDCF13','_EqualsFn_Invoke_m0384038C125073E87E851FE17A4A5FC334C7B5E4','_EqualsFn_Invoke_m4297891BD6D3EE993DDA637590C3E953B0CA2539','_EqualsFn_Invoke_m6FFE7A299261B8321381C8E4D2AF5E8B053326C8','_EqualsFn_Invoke_m03DE2EEABDE56233ACDA3F35AFCB9801052EF0BA','_EqualsFn_Invoke_m86F0B16AF670541DD59673CE680AE4B63EF2F129','_EqualsFn_Invoke_m2593027CBEC88899E7B5D96052EE569D482F737F','_EqualsFn_Invoke_mAD352A7FDEEFAA2F5E5B0FD0D6756057316A68B2','_EqualsFn_Invoke_m372B1D0BA99C9A7A1EC866F69B7DDE74E31B5C04','_EqualsFn_Invoke_mB80A263239520F88C0EC1B393293B2D443F4B71D','_EqualsFn_Invoke_mA783EB7695857BA9EF965E5809668CA41AD1BF5F','_EqualsFn_Invoke_mE0C03539384C727F37FBEE1FA767E527BC81E4EF','_EqualsFn_Invoke_m6E5F5E13EEC4EA0834F0533652596F003BA223B7','_EqualsFn_Invoke_mFFDEAA06E06ED384FC0A58FFAFD2911CE7CA596D','_EqualsFn_Invoke_mD5E876C797330F019B4C932D2BE00D3A322CBB81','_EqualsFn_Invoke_m378898AFA4428139A6AC04B4BB41BC1F7D41C2CF','_EqualsFn_Invoke_m4AAA023C24AD6A0A65E23D7F2F9D89BF6DB7AB4E','_EqualsFn_Invoke_m7C72D20A7A1CC9BA505FE99D3961A3D0819DE576','_EqualsFn_Invoke_m4B7EF43F733D17CA5ECDBA8013701C68B83599DC','_EqualsFn_Invoke_m235E568DCD7CC7BDE9639E978DDE0A36750A2927','_EqualsFn_Invoke_m0CABB55240FCD099CD6E1EEBBF25050B055D7CF9','_EqualsFn_Invoke_mA0354DCFE472C35DBDA13C27095EEEBD53789C74','_EqualsFn_Invoke_mCF8231FEE0D1D2780192805EFF83DF11E09DFA00','_EqualsFn_Invoke_mE16D2FB58318AFF24E70B967F1BA93069108599F','_EqualsFn_Invoke_mE231E2EB9CFD1B981446FD0B2C221568F0A58453','_EqualsFn_Invoke_m30285D25DAD4E2D904C12EDC581D19669003D91F','_EqualsFn_Invoke_m1ACE9730E226742B130F34AC2C124213423843D1','_EqualsFn_Invoke_m29D2E49EB34D4F85746D5CECBF71F189B2B468CA','_EqualsFn_Invoke_m38771F3DE08C9D6AB850AC3C9A5C5BBBA54F95F1','_EqualsFn_Invoke_m56F6311C9EEF099149CEF4E13671FA18AD5E1806','_EqualsFn_Invoke_mF5E427584A4014B373486D0887790F36ED1C98CC','_EqualsFn_Invoke_mA781A7202090272CA3344CC3DE73A828D36DDF14','_EqualsFn_Invoke_m1E90A46F5BBC39989CEA140BDAE1A5AF42BF11DA','_EqualsFn_Invoke_mCFC76A07D97B2C7C909552A11CAB8AD8074C9017','_EqualsFn_Invoke_mF41531856A9C80A557D01A8E0F9CF3484B4FB6F4','_EqualsFn_Invoke_mB7AAC996781799D15BB0BE590E9A57C66BFB4C25','_EqualsFn_Invoke_m9A4E18AC2438714E15C29969BC85E123D4222B2F','_EqualsFn_Invoke_m4E2E454F942A5C8829B3B8A26FAF60B77EA55EB7','_EqualsFn_Invoke_m14245D006FFE281AD8E7E08478F5E5155CF97ABD','_EqualsFn_Invoke_m5FCB60E8D0631CA487CD4A85C830407C87366CFD','_EqualsFn_Invoke_m0DE9B6A68A0EEEAEA92EF43048D1EBA4BA0BC41E','_EqualsFn_Invoke_mB0BA9D1BDC16EDA71D8EE07F47183615B27DA888','_EqualsFn_Invoke_m33B3470B0C4A7470766D0BF1FC647E565C2A05C0','_EqualsFn_Invoke_m9408EF7043B845DB2B1534CED55B5A4C7CBD7C79','_EqualsFn_Invoke_mA683D894BD6815C6BB18FEA316006133BBF24F02','_EqualsFn_Invoke_m3BEB4A1A82444862B902E65F1DC53AA4759CCBEB','_EqualsFn_Invoke_m173835D79657F7B088EE341736D464B0B6AF03A0','_EqualsFn_Invoke_mDB2F6382D298C5973FDA63D37BEA8AEAAB1F0AD0','_EqualsFn_Invoke_mCDE233E89C43EC1CEAF7D9AC34133640399C8AD9','_EqualsFn_Invoke_mF5A154180344454B2E51668D03FBFA4B25B2D269','_EqualsFn_Invoke_m70D2E4535E2191CE322D94C37C7D57EF33FC4031','_EqualsFn_Invoke_m6611CD6AC309CF5662A01BEBCB448B2111EA2EFB','_EqualsFn_Invoke_mF53BFDE6AFD9F302435DAEB4B8A7C41BA6BC5CF0','_EqualsFn_Invoke_mA277DB2059792E17291FF9B805EFEAD81E26D2CE','_EqualsFn_Invoke_m86674DB5DA915090217B6E6D71F3645AE263AF39','_EqualsFn_Invoke_m7DC9D5CCD84993F0D3A2AD02483E7015F26BF131','_EqualsFn_Invoke_m4492EEBD351F0332FE692B0EF04A283326676739','_EqualsFn_Invoke_m86887F615D963FA17DCA198F290A8EEFDDEC85CD','_EqualsFn_Invoke_m3C871E922570401C3FAF81264D937B8F7FF8AC99','_EqualsFn_Invoke_mEC95CEAAE1ECDEEA1A264855388A860AD57DEA7C','_EqualsFn_Invoke_mCBF8AD7D7B07624995A0D3508B5F50CCE65A1137','_EqualsFn_Invoke_m75C2757EA3C961234A6DFF4EDFE05B52FE1B1FE5','_EqualsFn_Invoke_mD25B5D4B43C6F717569135C30337B0543E0509ED','_EqualsFn_Invoke_m943578C4850E9954485F5BF1C92FE2C6394B184F','_EqualsFn_Invoke_mCB2A2576B3061E031B48226CE353AEABE265B6AC','_EqualsFn_Invoke_m9A3AEC88A513F686DF17FACFC81B4AC5402E4371','_EqualsFn_Invoke_m1CCA6DF403FBE04564DC9AB78CE15C4AD7FA2EF7','_EqualsFn_Invoke_mB2927998A2F58ED319CC0D93B3276ADA622C68AD','_EqualsFn_Invoke_m738E945EAB93C3D72D4D3689B303801018AE51D0','_EqualsFn_Invoke_m252F11FBD5F61F21339B4F343E32A234701EB1AF','_EqualsFn_Invoke_m094371FB1A5E69239EF30039F6A1D5B4B3159EC9','_EqualsFn_Invoke_m1EC9C079EC0D8736AB10ECE778993B6BAA101D40','_EqualsFn_Invoke_m713EF44B8900911E8A6DB5107F5CF3A66CE1A62F','_EqualsFn_Invoke_m1795473D5009CCCDA39B968D9E16A00055FA1BAE','_EqualsFn_Invoke_m570AFC1F625598BB21B0C17CA800B02102783E35','_EqualsFn_Invoke_m0256B1F64CF01B1FC9D8613BB62D6073CA0A0C35','_EqualsFn_Invoke_m0E067E68190D03C1753AEE54D380AB3BEB94B89A','_EqualsFn_Invoke_mF49ADCE68EF6DDA90F49BD13729D3229983B2A26','_EqualsFn_Invoke_mC2901BC08923969206915CDBA1F2E25D97643906','_EqualsFn_Invoke_m74F361ABE9065A5B4228B5E524CB857EDC51A981','_EqualsFn_Invoke_mCB10CD587709A2003F680BD8A5EB204723F85BB0','_EqualsFn_Invoke_m70D7C41F601213A063D19679A0ADA37BE1DCBF4F','_EqualsFn_Invoke_m04328444EEE2621C5180145AE75CB12B2C0C1C41','_EqualsFn_Invoke_m63026A840361DB737CBAD06A8F28F0F60FE1F657','_EqualsFn_Invoke_m1BD3AC683297E6D7F21B5EB1A991E725B3E14B43','_EqualsFn_Invoke_m36C14679F0AA9938A91E8C41F9170B5580A374CD','_EqualsFn_Invoke_m5C92190FDCA106A9EAB3E40A1AB987C07C9C60C9','_EqualsFn_Invoke_m0E67E2C028A48058A55332BBA159ECDC3C0AACEF','_EqualsFn_Invoke_m72D93C2D3FD86CEDF269E841713AC0229ABC1E3C','_EqualsFn_Invoke_m15B8F51593253F2BA43B614204BB4760693BE972','_EqualsFn_Invoke_m59A86DCB15D1573D843FB5127FE13D89403552E7','_EqualsFn_Invoke_mCE029F6637CE993C4AEE383CAADB32E2DC529AB6','_EqualsFn_Invoke_m0A4BA5FCD27990C26661DA433B2AFD333EC34F67','_EqualsFn_Invoke_m68049BB7847AFF89BD0B31821DC2DFC6E49E4112','_EqualsFn_Invoke_m0DF72B1566158C53C61C65CA443746BC0DEF3F62','_EqualsFn_Invoke_mE059E98D8E2DB670AD1C873594304F0A6D3796A3','_EqualsFn_Invoke_m80CBA75B5375B1F7592289B52D5BCE0937F4E35A','_EqualsFn_Invoke_m63FD37E71040D2DB75DE4CBE5D1306867AAC6712','_EqualsFn_Invoke_m22BBF4BE7B1D973120047ADEB4E5493E3D9B5370','_EqualsFn_Invoke_m11E767E96A625FFAAFDD4ECB99D65735E74A92B3','_EqualsFn_Invoke_mBCC6121252A1FABF4E82B495F4164232086262BD','_EqualsFn_Invoke_mF1FEBFC94CAB6EBBF830EBC32E48EBF8DE966411','_EqualsFn_Invoke_m35EE073B02B7AD0E49D87A5B4905ED31D09B2D89','_EqualsFn_Invoke_mA77FFC348BBFA61A7A7FEA702AFCD13CD801E240','_EqualsFn_Invoke_m200FC61F0D0BDDA8B58768D2105FE0448C0E7CFE','_EqualsFn_Invoke_mEDBA0160749A7A6DF40EE36687EB4026CB636E22','_EqualsFn_Invoke_mAAB2E6C5B0049BF1F60329E54CE3F22BF86EFEB3','_EqualsFn_Invoke_m8D7978968414DCE39B0A599B62A1C3E58F8AE7A0','_EqualsFn_Invoke_mC278B402F2E1F457C1413FD56AB24F43C562C4C2','_EqualsFn_Invoke_m7594D01C23C316723642FF3E901491602463A715','_MakeEntryShape_MakeEntry_m0967FA891E053ED629800F869B6C005C140C9CB7','_MakeEntryText_MakeEntry_mF3C1A0DB8F9007F7E59DEB9135456DF4A2A9CAB8','_MakeEntrySprite_MakeEntry_m75F1E33BE09DE44193431E6AFF5BE956C5DE1E31','_MakeEntrySortingGroup_MakeEntry_m0B74700D1D3CFB0C36E57A9E1189EDE91792F7EF','_BasicComparer_1_Equals_mA718356D3A967FEE7D11784CB27CBDA0F27B1C7F','_BasicComparer_1_Equals_m62BD6AFBD77A4541F98E496FEF9A4E4B4E2EA7AE','_BasicComparer_1_Equals_m0CB0EBBCFB16E5FD10FFBD5A72B4074D7D04D001','_BasicComparer_1_Equals_m1BC70B5DA380A124B1332B2A251EC804E227DD6F','_BasicComparer_1_Equals_m380581A9070F4FCE9E8DE67BE70D53648A0F7A8E','_BasicComparer_1_Equals_mF35F44E409FBF95A8EDE9739B5F844B0F3E877BA','_BasicComparer_1_Equals_m5E23D75E6A93C5144FD0CE2702F9DC5DEDE057B4','_BasicComparer_1_Equals_m6A8C6B7C6D8E77AC26F1647AC56722143B45E120','_BasicComparer_1_Equals_mCF7E30F232BE71E861976231BF1708AFF63F8730','_BasicComparer_1_Equals_m733E2419E2604979B5EB4DDFA954FB279A457AB7','___stdio_write','___stdio_seek','___stdout_write','_sn_write','__ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv','_EntityManagerDelegates_CallHasComponentRaw_m90BC43D3BE546E80311869D2FF57AD79FCFB679E','_ReversePInvokeWrapper_EntityManagerDelegates_CallHasComponentRaw_m90BC43D3BE546E80311869D2FF57AD79FCFB679E','_EntityManagerDelegates_CallGetComponentDataPtrRawRO_mCF972E7E13C6B2A9068863C1C6C3EA0B1A112B72','_ReversePInvokeWrapper_EntityManagerDelegates_CallGetComponentDataPtrRawRO_mCF972E7E13C6B2A9068863C1C6C3EA0B1A112B72','_EntityManagerDelegates_CallGetComponentDataPtrRawRW_m370449AE3A6261BC72A78F35DF5B6C791A157AFD','_ReversePInvokeWrapper_EntityManagerDelegates_CallGetComponentDataPtrRawRW_m370449AE3A6261BC72A78F35DF5B6C791A157AFD','_EntityManagerDelegates_CallCreateArchetypeRaw_mFD78967BDDFA6FE4454006AF4F39D480F159A223','_ReversePInvokeWrapper_EntityManagerDelegates_CallCreateArchetypeRaw_mFD78967BDDFA6FE4454006AF4F39D480F159A223','_EntityManagerDelegates_CallGetBufferElementDataPtrRawRO_mDF4D7344B1222AD8113215A2B29538D9A02E9DCF','_ReversePInvokeWrapper_EntityManagerDelegates_CallGetBufferElementDataPtrRawRO_mDF4D7344B1222AD8113215A2B29538D9A02E9DCF','_EntityManagerDelegates_CallGetBufferElementDataPtrRawRW_mC3B66AE3152D8AFC5F9F7C0F6E8329264CA08EBE','_ReversePInvokeWrapper_EntityManagerDelegates_CallGetBufferElementDataPtrRawRW_mC3B66AE3152D8AFC5F9F7C0F6E8329264CA08EBE','_EntityManagerDelegates_CallGetBufferElementDataLength_mFF4882DA0A1980D6584E7E8EABCD110B469D065A','_ReversePInvokeWrapper_EntityManagerDelegates_CallGetBufferElementDataLength_mFF4882DA0A1980D6584E7E8EABCD110B469D065A',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iiiii = [0,'_HasComponentDataRawType_Invoke_m98DB737D8F5ECB68C4A281E866DE432B7F6E4094','_GetComponentDataPtrRawROType_Invoke_m0E0EFE5B1D6FD739DF486C21E8DE7795BB61BB6C','_GetComponentDataPtrRawRWType_Invoke_m6732A33E5DF9F264302247E9014106C3AFB2FC21','_CreateArchetypeRawType_Invoke_m12B9E383A48DDB4B3AB59A9EB2A51BA79C845142','_GetBufferElementDataPtrRawROType_Invoke_m7C28C819D14E5B4526CC35A12EFAD6334DA9353E','_GetBufferElementDataPtrRawRWType_Invoke_mCEE422F2495826CD1186154FA1DB6EF00BEEE828','_GetBufferElementDataLengthType_Invoke_m3A5CA4A309747CA51F86D0ED0413E54729666346','_GC_gcj_fake_mark_proc',0,0,0,0,0,0,0];
var debug_table_iiiiiiiii = [0,'_Image2DIOHTMLLoader_CheckLoading_m453F9A03C5A4529592C98B082CAA4A1976734C03','_AudioHTMLSystemLoadFromFile_CheckLoading_mAB1B6BBDD1A4046BB4BFE5CC79B51588D71EDDB5',0];
var debug_table_iij = [0,'_TypeIndexForStableTypeHashType_Invoke_mCF3EABF443DB72F6EA67EED8F26AFD317670D90B','_UInt64_Equals_m22374855BBE5887189F1CD99F9920A3F8D9F535C_AdjustorThunk','_UInt64_CompareTo_mD044035D351FEABE7111BDCC165FA9068F7FE64E_AdjustorThunk'];
var debug_table_ij = [0,'_EntityManagerDelegates_CallTypeIndexForStableTypeHash_mCED1E9A54EE44F12169841DBBE6EDD3F9D167E1A','_ReversePInvokeWrapper_EntityManagerDelegates_CallTypeIndexForStableTypeHash_mCED1E9A54EE44F12169841DBBE6EDD3F9D167E1A',0];
var debug_table_ji = [0,'_Enumerator_get_Current_m95C1EF83AC550AF880BF1B88DA413BBF613E3A2C_AdjustorThunk'];
var debug_table_v = [0,'__ZL25default_terminate_handlerv','__ZN10__cxxabiv112_GLOBAL__N_110construct_Ev',0];
var debug_table_vi = [0,'_BlobAssetOwner_Dispose_m620D61674E0C7A5C20EB3A2FC77DC89CF8411136_AdjustorThunk','_EntityCommandBufferSystem_OnCreate_mF816CBA127AA5431F73B4A85B7DE28368F2B2C6C','_ComponentSystemBase_OnStartRunning_mEFEB79B59AF00EE313E0C6DF5FC879242FE523FA','_EntityCommandBufferSystem_OnDestroy_m107FB0C8EE400880095FFDEEA77A0A7B49CFFCBF','_ComponentSystem_InternalUpdate_mAC26D32849BD0926103E626A33A8B77E450C056C','_ComponentSystem_OnBeforeDestroyInternal_m0FC46699E754F690C986B28FC05553FC0AE97ECB','_EntityCommandBufferSystem_OnUpdate_mFE4D00501C6A340D30CF5613ABEE808C5C582C7A','_ComponentSystemBase_OnCreate_m99034C4B5FA7E126F7A6AEA75B76A3E54EF081DB','_ComponentSystemBase_OnDestroy_mD6E99A04567D935520B45070A5E85DFD44EC22B4','_ComponentSystemBase_OnBeforeDestroyInternal_mE02D5D37850349358F792E386CA069F7FD96064B','_InitializationSystemGroup_OnCreate_mFB0EDFD306E9BF3FE040DFB5331F3E7A02A6C6BA','_ComponentSystemGroup_OnUpdate_m8D5B89AC0574EA5263DE05BEC7D83A6F2549FCD3','_InitializationSystemGroup_SortSystemUpdateList_mA957EF41B3678C9B805CC39BEF578E125B0FBD99','_ComponentSystemGroup_SortSystemUpdateList_m13156A410C583C262027F5B0F4B83E42B7E4916A','_SimulationSystemGroup_OnCreate_m3F3EBDBAC9E31B6A303882E6EE4B0DED0A42533D','_SimulationSystemGroup_SortSystemUpdateList_m4E9E4E0EEEBD13A58181425E44F632E554DA2291','_PresentationSystemGroup_OnCreate_mEF4FF86643EB28A6ADD37C677577E5DAF50FDE0A','_PresentationSystemGroup_SortSystemUpdateList_m1989B4D211D9CDB6FBE0C46F7620C0E9FC3A72F8','_TinyEnvironment_OnCreate_m463A51D42981AEFB486F36D423CF299479AF66CC','_TinyEnvironment_OnDestroy_mBAF8D7E28F75BAC27B47226E1C81DE33D4A25845','_TinyEnvironment_OnUpdate_m307EF30124ABBFE1562C7D4E28DF5DFFE0E25B81','_Image2DMaskInit_OnUpdate_m75B2447DD676ECDEDB60EDF685DAA0CF025F7B93','_WatchersSystem_OnUpdate_mCFE1CE866BFD0584D7E8C9E16639B9FF23D6ED5E','_EntityReferenceRemapSystem_OnCreate_mF2AF2F5BBF28126E48805C56EBB078B957A377E0','_EntityReferenceRemapSystem_OnUpdate_m0FC5E6D2805144DDAF86EC0D90F148C06062B94C','_ClearRemappedEntityReferenceSystem_OnCreate_m3EAE2C6CE5C03EB2903C6E5E39AB9979318685C5','_ClearRemappedEntityReferenceSystem_OnUpdate_m71A1207AAE9FF690D2BC6549CD2E58259525D1CC','_RemoveRemapInformationSystem_OnCreate_m23987815B60CBD7DC9EB5DB9CC11721D867657B8','_RemoveRemapInformationSystem_OnUpdate_mCE922105F86AE49F7F3927EA47873EAAD4FAFA02','_SceneStreamingSystem_OnCreate_mD0CE54841892026336AED59303C7EEBB314FEB34','_SceneStreamingSystem_OnDestroy_m3ED8D8F5D366DF0ED3A3B366781B4D4F73254FF7','_SceneStreamingSystem_OnUpdate_m97E2E3FCA3893997D83DC30F12326E9B5834173F','_DisplayListSystem_OnCreate_mA465450C3325F95AE71EF1B84604BF290E613E69','_DisplayListSystem_OnDestroy_mB8E9630226F3A73ACBF051E773CE310DF674955D','_DisplayListSystem_OnUpdate_m0FAE0FF22C53153986B48079C85433C0E8C5E3ED','_TransformHelpersSystem_OnUpdate_m6C2598E2B3B99E2F76263C11A1C39BC33394924E','_UpdateLocalTransformSystem_OnUpdate_mE44B3753B5D5F56EB987D159677491C8FD2AA5F9','_UpdateWorldTransformSystem_OnUpdate_m86975EE3C5F731AA2C640FB6671E20F2B8CD0856','_Shape2DInitSystem_OnCreate_m172CB8FCE58E27A88037D61E7DFAF71ED2A90793','_Shape2DInitSystem_OnDestroy_m632A038878252BC15A5C9203D81C38B875746EF9','_Shape2DInitSystem_OnUpdate_m80567BA1F401E3141DD0D9E1318CAA314F38407D','_Sprite2DSystem_OnCreate_mAFC0771180E210E7AD1B6D6AC75FA53C80071F66','_Sprite2DSystem_OnDestroy_m7F9B1E04330E7C1624BE73020F1983B5A01757AD','_Sprite2DSystem_OnUpdate_m868B489C8503A4051A9A1B2E87C73EA19C3CBB29','_SpriteAtlasSystem_OnUpdate_m4516EDF9C9B4669BA4012F561EBD8EF22B556053','_SequencePlayerSystem_OnUpdate_m896CF9C3E1E25367DA240B5DD125BBE902ED0263','_InputSystem_OnCreate_mD68CEE4E8BCDDB700C196A262CEF57E1AE4959D7','_InputSystem_OnDestroy_m63845925A5D7CD77D8E3125CB854ECDA9DAA8E0D','_InputSystem_OnUpdate_m4FF61A5DFB53C043ED57CEB389AC053FEE661A40','_Image2DIOHTMLSystem_OnCreate_mC47C0A47491863C3EDDCD9227A6ADA4C8AE2D186','_GenericAssetLoader_4_OnDestroy_m0E2066308945C8AA79D8ADDE83D9CDEF312F80F0','_Image2DIOHTMLSystem_OnUpdate_mBC74870A4DDD998862923489A631DD5AC03E3BA2','_GenericAssetLoader_4_OnCreate_m8420B75E9347C157BD3CE9DB67FE4023F9412DB1','_GenericAssetLoader_4_OnUpdate_m5CFCDE83B2CA595092E467AE1A8240ECDB372859','_HTMLWindowSystem_OnStartRunning_mDAF2EA52059D74536A3C731CF09749786697E7B3','_HTMLWindowSystem_OnDestroy_m993630CECB56C29DFB40EE532AC9D48D0BD9668F','_HTMLWindowSystem_OnUpdate_mBD78103A9CF060CD5DDB19125CC828DBB13C56F1','_AddMissingComponents_OnUpdate_mD7A18E8D07923E113000FC1B306E710895716307','_SetRectTransformSizeSystem_OnUpdate_mD394849235BBD1931B8A1F91D1A7F6A5E790B9BE','_SetSprite2DSizeSystem_OnUpdate_m127A59367F93DB8864C97C763E841E3895361D57','_UICanvasSystem_OnUpdate_mC83E9C642037A74758061E07B5DC5D10CA023539','_UILayoutSystem_OnUpdate_mC4C92D04A2096C64FEFCDAA8E25BC6CD9A6C9D26','_HTMLInputSystem_OnStartRunning_m33546641ED10D60C1EB76D673BA063EFC120E2EA','_HTMLInputSystem_OnDestroy_mF1AD7301053030628B553A2F949421D3149368CB','_HTMLInputSystem_OnUpdate_m6D710299E8B51E20E3004C79989DA611B3D3672F','_AudioIOHTMLSystem_OnCreate_mF5F54C46E995F47178F284D47364DF72E5A2D01C','_GenericAssetLoader_4_OnDestroy_m140FF9B28445953061834795469726E9AC9F2E92','_GenericAssetLoader_4_OnUpdate_mBB62D3208D65672B3AD162C2F2F50D449EF774DA','_GenericAssetLoader_4_OnCreate_m072296991888625E80F87C1981FD7AA61AF4A700','_AudioSystem_OnCreate_m74D41B6BB68B05ACC21A5D5047AC07DA6BAFEF96','_AudioSystem_OnDestroy_m6AA7005FF261B26A6A7D4769F2FF0FD7BC2200D7','_AudioHTMLSystem_OnUpdate_mE366D6F27B5346E659A1776711ADB49B45C93457','_AudioHTMLSystem_InitAudioSystem_m96906B279305750E1BD6925BE5DC44B6B8037529','_AudioSystem_OnUpdate_mE5252FC963FC9E6EE39B6B75ECDA9A1F2341AA25','_ButtonSystem_OnUpdate_mBB2967CF17B24D7C8DEDC494D248038F6FCA103D','_PointerInteractionSystem_OnStartRunning_m4213B5AA0C05D4525E86ACC2DDC77594DDFECD51','_PointerInteractionSystem_OnUpdate_mC0C766AFCF81648A8D5751562437287EC005C4CD','_ToggleCheckedSystem_OnUpdate_m6C181B057BE31EBE051B444B9CADA7A7B4957B49','_ToggleSystem_OnUpdate_m57951AC6D8BB9CB2018E4663C0B1ADEE81919C3D','_UIControlsSystem_OnUpdate_m95F0DD6D4877570608103673C177D0F06A66B96A','_Text2DInitSystem_OnCreate_mE4694520471531938E2AA755420D53FC10982797','_Text2DInitSystem_OnDestroy_mA695B11205FD2356D6C12904C230D2FE4FA2A284','_Text2DInitSystem_OnUpdate_m5F6487F2D232660569E50B6D1AB6DF5CE4253398','_TextBitmapFontSystem_OnCreate_mDC1C368CE7856D53851CC8014A15B54FF27EEDCE','_TextBitmapFontSystem_OnDestroy_mC80B843EAED13D7D765E243F4BD8C63205A26FFB','_TextBitmapFontSystem_OnUpdate_mA989F09604445AD97CE070588D264647593B9ADD','_TextNativeFontHtmlSystem_OnCreate_m91ACB4E43F2CD09A703026432B6CACEEC156E2A5','_TextNativeFontHtmlSystem_OnDestroy_m86E55A086BD3AD63E03E821573E9AAC8354B1391','_TextNativeFontHtmlSystem_OnUpdate_m6429E761583D87A551D27FF2F6F09C6B4E3B42F1','_RendererGLES2System_OnCreate_mE58F91D369BF9C250B3655C0C403F9D579174067','_RendererGLES2System_OnDestroy_m47B7E184BE4C4F0352FFE2DBAFFD4D5F9782FF4C','_RendererGLES2System_OnUpdate_mD7548E52BC2CA53D84B04388894D4C2289F38DF7','_RendererGLES2System_EndScene_m43621260F99C59265FCFAF5C0B034D10AABCA262','_RendererComponentSystem_OnCreate_m75214800258E8504EBF815B8ABFEA1CA0215AE8D','_RendererComponentSystem_OnDestroy_m2152E3320D715BAE0310FEE94883676197907281','_RendererComponentSystem_OnUpdate_m39914B7B2B9857F41CFEA2B8CB33CEF8B81701D2','_RendererCanvasSystem_OnCreate_m35B80AFB4FC394FBFB86AA2ED1DD599A8F9714AB','_RendererCanvasSystem_OnDestroy_m7D4479F52DDAE81BB0EEEA716FBBBAF35E6BC305','_RendererCanvasSystem_OnUpdate_m393AF50D4F220991BD3A77EA673DFB012316F467','_RendererCanvasSystem_EndScene_m33DD5CA6A904276996A5C2C37FD1383669DC2390','_DragAnimationSystem_OnUpdate_m0150EC2D6E5E1DE5918F823259981795D4E2B448','_MouseDragSystem_OnUpdate_mB9DBA2112C18821E228E7DDA04A8C04D89C47AF9','_MultiTouchDragSystem_OnUpdate_m570865929B734F4CD0FCFB0FA9BB936DB75CBC20','_VirtualCursorDragSystem_OnUpdate_m956186775F1ACB62482B6E0340783217498E07EA','_VirtualCursorSelectSystem_OnUpdate_m5872A5C40B7DB4AB3EB3DFA8B71A45AA82E27777','_ConnectPuzzlePieceSystem_OnUpdate_m074B3F83B4811F9E2412B61A300695E845E6D495','_PuzzleValidationSystem_OnUpdate_mBC7C531CE7A688C7D70331ABDDC5F105DA820701','_ResetPuzzleSystem_OnUpdate_m6DBBBC0EAEA85EBBC86C150DA8CB1C342EA4E751','_World_Dispose_mC2E7D0871CE15C08B05E6CCC69425890586AD96D','_MemoryBinaryReader_Dispose_m4EF877CF9D1EFD4C7D850C9B635CA1AA1D96B0DE','_InputData_Dispose_m6F26CE9B008F52C849A4FCC2137D2D76D35256CA','_DisposeSentinel_Finalize_m9EC65CDE6478C646EBAACE32B7FEBF76E295A7D6','_EntityQuery_Dispose_m0AD1DB3078C234F56A2F36297A54F15807C13E98','_EntityGroupManager_Dispose_mF39A4F6ED482B8068D1AE7D0A12AE99FEF8BB783','_EntityCommandBuffer_Dispose_mEAD0561873FC429DEC885758B3FF29D29A46A586_AdjustorThunk','_Enumerator_Dispose_m89834B4EB1758505BC7B2F3CAAB25C42DF495B11_AdjustorThunk','_Enumerator_Dispose_m23C998E884CBB63730661AFB80FE5EEC18694D88_AdjustorThunk','_Enumerator_Dispose_mDBCEA69267F2C5C16B92F1E9AF5916DB8A7F8E49_AdjustorThunk','_Enumerator_Dispose_m6E21EA6642D1EC63089A35EB68F2963237CFB78E_AdjustorThunk','_Enumerator_Dispose_m7DBF052E6EB650DE844DEA7A4FE5400C0125C607_AdjustorThunk','_Enumerator_Dispose_mD0F933C78BC186B90E38573AAD76A427E7064ABA_AdjustorThunk','_Enumerator_Dispose_mFB2EAEC8B5DF134006816BF642D802A68E39D649_AdjustorThunk','_Enumerator_Dispose_mDE95FCA9B0D5EE9B0CD5D8628F6BE36118FCAC42_AdjustorThunk','_Enumerator_Dispose_mB4C9D68BC7171DB5DA8F70C73790F7F3009C98CC_AdjustorThunk','_Enumerator_Dispose_mA7863D34685251CB6802ADE1FDC737E9ECAAD711_AdjustorThunk','_Enumerator_Dispose_m8952BF2DD7F24EFFE2879B08C397C75241E7FD1E_AdjustorThunk','_NativeArray_1_Dispose_mEE20D2FD007EB8CCD716F563FE15D9E83F57D3B0_AdjustorThunk','_Enumerator_Dispose_mFCE1B286D20B090A239E14EA9FAE4E08651FD17B_AdjustorThunk','_NativeArray_1_Dispose_m287EBE5FB8F3609628B2472DE3F5F51EB8FA68AF_AdjustorThunk','_Enumerator_Dispose_m4527FAF53D0A22CE5FE2C1D0B6D6A7AE6247C977_AdjustorThunk','_NativeArray_1_Dispose_m2F11D574E090DAE2669D45A0DC6F7B7F2CBDD055_AdjustorThunk','_Enumerator_Dispose_m7B8241B638811024291932743B7FE5640A27B23E_AdjustorThunk','_NativeArray_1_Dispose_m021CF145ECBFFB4523F25C66CDDFF62A7FCE16E5_AdjustorThunk','_Enumerator_Dispose_m16EE3A63C9B111CD148DA7C65C04CD7E9E2A6A18_AdjustorThunk','_NativeArray_1_Dispose_m5B50B0ECEED63074F2FB4700EB0F1566758B34FA_AdjustorThunk','_Enumerator_Dispose_m6B27FCD9E31BD02BD0608E8D5189F2AF80807D11_AdjustorThunk','_NativeArray_1_Dispose_m2024905381723939AC2662FCC512675ED9A21406_AdjustorThunk','_Enumerator_Dispose_mD526046B533D606F79D1DF3C793D17D4A03C13CD_AdjustorThunk','_NativeArray_1_Dispose_m2C92744138165C4CD1C7134D827CBBB1FF9F8F1B_AdjustorThunk','_Enumerator_Dispose_m437906500C5B15C7165ED4CA1826C8AA428CF9BD_AdjustorThunk','_NativeArray_1_Dispose_mE88B5A8D95250031C9BF93AF365C7B303A0316B3_AdjustorThunk','_Enumerator_Dispose_m2743720D8D3DE4615B08D5F554530E212296A0EC_AdjustorThunk','_NativeArray_1_Dispose_mF1CACF0F622E225CCB37D0D12BEC8F7C12E791A4_AdjustorThunk','_Enumerator_Dispose_m9AACE8A6DC3AB24FFFE49B04AD65C12BBEAE6D0F_AdjustorThunk','_NativeArray_1_Dispose_mA1B574D8F5D821FB1829AD2F4B3DF18066A589C5_AdjustorThunk','_Enumerator_Dispose_mF627C06605A728ABDCF7924484DA57C711E3A045_AdjustorThunk','_NativeArray_1_Dispose_mC15985BD2AB148559195DA63909199F542FC9E0E_AdjustorThunk','_Enumerator_Dispose_m50E7D0505CF07CA686D8FE12633B7A5C6BAAEEB1_AdjustorThunk','_NativeArray_1_Dispose_m247586E4D49D673C13EACFFC1EADBCE131D2B8C0_AdjustorThunk','_Enumerator_Dispose_mDF6CB9B5C77BB855BA42444794DBE0FFA638741B_AdjustorThunk','_NativeArray_1_Dispose_m624CF0B9662CE24A5D2335DB5522DD27215175E3_AdjustorThunk','_Enumerator_Dispose_m7F6064654A24F90B953341958E7179591E29E7E6_AdjustorThunk','_NativeArray_1_Dispose_m998FD0D1A5C396601B12DF4BCB25D7F05FF43B95_AdjustorThunk','_Enumerator_Dispose_m1C91CDE79E0E168180131EDF4503188B27ACB313_AdjustorThunk','_NativeArray_1_Dispose_m9C5BAF717E0F46EA1003A6FF9D4E584CD5D05E60_AdjustorThunk','_Enumerator_Dispose_mBF6DC7E526424EA566C0D2E5EE41AE90AF20C98F_AdjustorThunk','_NativeArray_1_Dispose_m46D9E4931786D7715A627052FC68F58087A4FC4C_AdjustorThunk','_Enumerator_Dispose_m63C51E4554B7559F3CA1D432E0BE926C8618D746_AdjustorThunk','_NativeArray_1_Dispose_m4A5BD81B7C1055420A26733FF73C79264D0B90F1_AdjustorThunk','_Enumerator_Dispose_m2FC722443ECE0879395ED35735548205ECFCEC98_AdjustorThunk','_NativeArray_1_Dispose_m8FA94D5DD3B1714F74ACDBA905134A3C4A515C2C_AdjustorThunk','_Enumerator_Dispose_m9CD2AC65597A9A3F281F7B00F9140D33A3CB8373_AdjustorThunk','_NativeArray_1_Dispose_m5F89E624D66FB18EE6BD6E3ACD6B63D7E1223A02_AdjustorThunk','_Enumerator_Dispose_m403E8911EEBC9DFCBB711EA50B305A79BDBAEF9D_AdjustorThunk','_NativeArray_1_Dispose_m6A364B882B179DE36C72A4FB49341EB16530F2D4_AdjustorThunk','_Enumerator_Dispose_m2422B4782D4D7B8772CAFA9C332C8017F5EFD013_AdjustorThunk','_NativeArray_1_Dispose_m0C30F60FBCBE4C9476D5EBFC550F1A9D42637B7E_AdjustorThunk','_Enumerator_Dispose_mA35795FB79DC520C8AF846BE5E01D1D1870B4FE8_AdjustorThunk','_NativeArray_1_Dispose_mA05B6FCE49D7C43EE14083C5DCFBD6FDBA377FC5_AdjustorThunk','_Enumerator_Dispose_m27143E637F1AC13E8D369E98D9E839DC84983ADC_AdjustorThunk','_NativeArray_1_Dispose_mA12829AA1C35C026B4559DFC225EF2DA481B9069_AdjustorThunk','_Enumerator_Dispose_mBE518E04483F6BA7946594B1E346E1508107313D_AdjustorThunk','_NativeArray_1_Dispose_mA2182259D1210BFB4EF8DFE950AD7438DA739430_AdjustorThunk','_Enumerator_Dispose_m621AC681EC9B391756BE9163A79527BE0532AFC1_AdjustorThunk','_NativeArray_1_Dispose_mAE59F6F6BECFB7A5BDE227A0186ACC76439FB707_AdjustorThunk','_Enumerator_Dispose_m3BBE39D5321CDF49225B17E305DF29ABE23DC8E7_AdjustorThunk','_NativeArray_1_Dispose_m2671B4A5046998B6EC9388A6856A869CC8EF3F20_AdjustorThunk','_Enumerator_Dispose_m8ADE9F90FDED81EFEBE31273F3514312995676C1_AdjustorThunk','_NativeArray_1_Dispose_m126DA7B61AA023D6DA4C03F527BA348CE1C15D26_AdjustorThunk','_Enumerator_Dispose_m4AE05EF4F3E2B97D481D50BE16D6567164BBC67F_AdjustorThunk','_NativeArray_1_Dispose_m2879490EF42097B5126524E37BA43AC6134F46D4_AdjustorThunk','_Enumerator_Dispose_m442A82CF985DA8256CBED953C5810C1B4E8751A1_AdjustorThunk','_NativeArray_1_Dispose_mC677D933FB8641B4DEB23EF67EA95A539161F222_AdjustorThunk','_Enumerator_Dispose_m50D4DF97F8038BF44290B750BE8FCDDFD24B308B_AdjustorThunk','_NativeArray_1_Dispose_m8CD21F87172B56734A2A38DE26C550B9DD098327_AdjustorThunk','_Enumerator_Dispose_m718EEB03B0A55659DFF92851D14F4FD64DCAC2B4_AdjustorThunk','_NativeArray_1_Dispose_mD9471C1EE8CE1CA5117577F104AB3C5E1154E1C0_AdjustorThunk','_Enumerator_Dispose_m8E97F982AC197CAB272F9A78EFB7518B60E82501_AdjustorThunk','_NativeArray_1_Dispose_m4DBFD669E82D4042FB32BB9A118E4DB731C810DF_AdjustorThunk','_Enumerator_Dispose_m1E75D31D50E49C8CAB1ED5B679D842012D54C353_AdjustorThunk','_NativeArray_1_Dispose_mC306E15BC5306A5C44B23B0480DF6B66A3227218_AdjustorThunk','_Enumerator_Dispose_m505EF31B80B12849DCFBC318BBCBFE7D39D31AB9_AdjustorThunk','_NativeArray_1_Dispose_m33A6FA92EC84D475FDB3FD687585FC7D452A7CFA_AdjustorThunk','_Enumerator_Dispose_mB6AC709730401A341B69E4D066B4BF1A9084AC54_AdjustorThunk','_NativeArray_1_Dispose_m994207904E87BD56BA671F50CD0BF7DE9426088A_AdjustorThunk','_Enumerator_Dispose_mD8FB7954837224A63C9F08D28BB72ACF60BE6926_AdjustorThunk','_NativeArray_1_Dispose_m6999D978ABDFAE2BD29D78E7D7BF9CB1999A5B2D_AdjustorThunk','_Enumerator_Dispose_m42368DE2BBBEA50C508CB2931569C5892B5FD68A_AdjustorThunk','_NativeArray_1_Dispose_mC92443F1EE07860FF7D528E43C6AC679C774AEA8_AdjustorThunk','_Enumerator_Dispose_m3B80BA8E4AD4DB6857CBD69A6CD3C56B4F902887_AdjustorThunk','_NativeArray_1_Dispose_m3C1B583357FD09153A194D964C7E3A3082B816AC_AdjustorThunk','_Enumerator_Dispose_m93FDB287B11F0F91F746EC79C4F87C3F2E161B4F_AdjustorThunk','_NativeArray_1_Dispose_m73C35893A6308DD9F043B2893D037C02CC363360_AdjustorThunk','_Enumerator_Dispose_m6AC746DCC64BE050DD16B4B8E0950222DE9315BC_AdjustorThunk','_NativeArray_1_Dispose_mADBF8DAA71B04EA47F8C2953BE19E520CD303557_AdjustorThunk','_Enumerator_Dispose_m824F3885FAC3838E7A048F831B0255F0330C9158_AdjustorThunk','_NativeArray_1_Dispose_m30CA74B5E28493EB69DF7955AC26795E8054BAA1_AdjustorThunk','_Enumerator_Dispose_m1FEC416BE93A748DB6A618F96E597BC1FBF0634B_AdjustorThunk','_NativeArray_1_Dispose_m2BD7AAB570B8879B8AC0FAA918B574E79CC191CC_AdjustorThunk','_Enumerator_Dispose_mE744842AD08C7D55A46BF4CAB809FB752E67A2C0_AdjustorThunk','_NativeArray_1_Dispose_m88CE311C787F6F819442C66D9699851C45734A07_AdjustorThunk','_Enumerator_Dispose_mD825E73BCFD0764BCA30C92F457EB85E527DB1F2_AdjustorThunk','_NativeArray_1_Dispose_mED7E3352ABFA6CC8F2B62002E1ED92050009ADF6_AdjustorThunk','_Enumerator_Dispose_m4E6054CCF7D3558E0298A8613ADFC9A4D1D9CA18_AdjustorThunk','_NativeArray_1_Dispose_m3F73A245C749E9BBE06B57E2F868F3DDD3B40462_AdjustorThunk','_Enumerator_Dispose_m62E320DDEC895058B65898350E7F217CAAF274FA_AdjustorThunk','_NativeArray_1_Dispose_mD36E8EA6973AAFFCA9AC73091086A7E11F33AEFF_AdjustorThunk','_Enumerator_Dispose_mCD68A562935EDD2403A4054F49A2E6B7F1A400CA_AdjustorThunk','_NativeArray_1_Dispose_mA0E29A4A629CBEB44A6DB21A49A1D16ABBE89079_AdjustorThunk','_Enumerator_Dispose_mA6959E5584D483D1D03B66D3EF00D7EDB6DA6775_AdjustorThunk','_NativeArray_1_Dispose_m8BB3A33F972E93F880518F5B3A1D8B383FAC41FA_AdjustorThunk','_Enumerator_Dispose_m91134138F6F5840CD212A38FA8884A2472564984_AdjustorThunk','_NativeArray_1_Dispose_mE0FF2EC872C0D077BB7A0D775F47AD128E1B9A3B_AdjustorThunk','_Enumerator_Dispose_m02CE39F7FD0CD8F3D7F919B0D339001DBC695480_AdjustorThunk','_NativeArray_1_Dispose_m82F4B81DB212F136096157481CF807C6C167410A_AdjustorThunk','_Enumerator_Dispose_mB9462C2AF90563C4D4E4754C6138D345BAB9982B_AdjustorThunk','_NativeArray_1_Dispose_m37EF640B60F03963D9E9717E869FC70EC64EC62F_AdjustorThunk','_Enumerator_Dispose_mAEE0ADA108931E7E3E926F25CEA1844F22C3CA8B_AdjustorThunk','_NativeArray_1_Dispose_m3DC5979AF86293F2F82EF7B9719EEA72EFA0990E_AdjustorThunk','_Enumerator_Dispose_m4659E0955B1AF7005236FF30D9E6D4CCF042D9EC_AdjustorThunk','_NativeArray_1_Dispose_m0281220F42359392C560F13C1CF17CF7BD80A819_AdjustorThunk','_Enumerator_Dispose_m903A16BEC40F605C40E530AE5F7DF7C47EA84D12_AdjustorThunk','_NativeArray_1_Dispose_mEA25E641DAD27FEA19D0D622A582E37A43F1E8FB_AdjustorThunk','_Enumerator_Dispose_m37562ADB8BD26B27B06581F8D7E515F8A351A00C_AdjustorThunk','_NativeArray_1_Dispose_mE88E38A7B90FDE737D3CC833A74ACA1E3075B130_AdjustorThunk','_Enumerator_Dispose_m24A3330E015D5BED4C8A744AD24C77408FAF3F10_AdjustorThunk','_NativeArray_1_Dispose_m4FEC8B33CACCBF83EE5616CAA396CA006FE88E08_AdjustorThunk','_Enumerator_Dispose_m655618D11643DFA832D67F8B075C6DC406BB8B7E_AdjustorThunk','_NativeArray_1_Dispose_m03139EB1464112F2455799F1D6D1E19A7DA8E3FB_AdjustorThunk','_Enumerator_Dispose_m38DE70207CC07F97FBC2A11220638ECB311562B5_AdjustorThunk','_NativeArray_1_Dispose_mA25C9BD20CD2E885B3A1619DCD7F82FFC455167F_AdjustorThunk','_Enumerator_Dispose_mF85F247A0BAF130CD7749416C4D4A28B7B5E815E_AdjustorThunk','_NativeArray_1_Dispose_mBAC6FF35CC46255F50980E90A03B879189AF2C7D_AdjustorThunk','_Enumerator_Dispose_m7A79E3B4E1595005206656B427F444F07CD5C765_AdjustorThunk','_NativeArray_1_Dispose_m7405121FD2AEA4A51A955F17980D818A55AFD663_AdjustorThunk','_Enumerator_Dispose_m43778CAB8AC3EF642BAE3B509BEF599E120493C6_AdjustorThunk','_NativeArray_1_Dispose_m5F64A103332CA97E7A1E1ABF46B0F3181ED2C2D2_AdjustorThunk','_Enumerator_Dispose_mF0C2CFEE0143F45EE7EF685EEB7F427E16DA54F2_AdjustorThunk','_NativeArray_1_Dispose_mA4A867FF9E42FC71B2C597760FCF3F0B72F7C8F8_AdjustorThunk','_Enumerator_Dispose_mA89F755DDB6E399DE0FB6A03849AF72486890537_AdjustorThunk','_NativeArray_1_Dispose_mF71C124C42D01B76DFF1A48AA11CBBC3BF1B36F2_AdjustorThunk','_Enumerator_Dispose_m0097CB8F3B0E9EC305C1484698670F36BE37CF59_AdjustorThunk','_NativeArray_1_Dispose_mBDB15F693163B95B5C7A63CC0DA2D9CAA82934E1_AdjustorThunk','_Enumerator_Dispose_m2389483AD7607B519A4C2F6F3375EB91D67F87E7_AdjustorThunk','_NativeArray_1_Dispose_mDE4FFCA8BAE6A06E10C1E10576DE8C42895353D0_AdjustorThunk','_Enumerator_Dispose_m96765D45B0436F26AB89BC0020DA748FC4A4BDD1_AdjustorThunk','_NativeArray_1_Dispose_m713134E960E0A4AC404028124A78560A4BA6E96B_AdjustorThunk','_Enumerator_Dispose_m78CBC25E1DC9652FFF24C111EC167044D5CA8B6D_AdjustorThunk','_NativeArray_1_Dispose_mEED5489101BCCB2D04D1446849FF39EAAF281908_AdjustorThunk','_Enumerator_Dispose_mDEDB25FDA40EC2C7DE1891AB415559EC7B78A3C2_AdjustorThunk','_NativeArray_1_Dispose_mCCF7400398AE5225935A9EBD08733FDB68586591_AdjustorThunk','_Enumerator_Dispose_m83E19174BB72F29ED1DBBC10709C1ED228D13626_AdjustorThunk','_NativeArray_1_Dispose_m68283CD9DBC3F48025348929EBD9F3BDFE4B62E8_AdjustorThunk','_Enumerator_Dispose_m9766650D5558FFF2F9296F75603BB96DEB46A5D2_AdjustorThunk','_NativeArray_1_Dispose_mA74C4F0FE62F56E3CFA3182874DD68FA431EE45F_AdjustorThunk','_Enumerator_Dispose_mC5F89AECC4706DBAF58C707876953EBA74E0FB3E_AdjustorThunk','_NativeArray_1_Dispose_m87E1652F996CC5DE3116EE0087A950CCB45E509E_AdjustorThunk','_Enumerator_Dispose_mAEA5447242BA5CB503603B30283CE2FC46164736_AdjustorThunk','_NativeArray_1_Dispose_m6262CD754CD25362734F23AECDEAE5F6F35D0AED_AdjustorThunk','_Enumerator_Dispose_mF39BFF5346D16C35D4C77101A5A798519247D1C3_AdjustorThunk','_NativeArray_1_Dispose_m7B7D4514AA20E13BC5C588226C21A1B3130260FA_AdjustorThunk','_Enumerator_Dispose_mA2D9D88A9B3DE277B8C3599865DDE4414D87DEE7_AdjustorThunk','_NativeArray_1_Dispose_mB410E7C952E62BBA05083D9652C6A7E164C7453D_AdjustorThunk','_Enumerator_Dispose_mB232E26F90791D357CA02BB5610949A60DF0F862_AdjustorThunk','_NativeArray_1_Dispose_m0C252C9C69D83019428E742834F12D31BC82AC7F_AdjustorThunk','_Enumerator_Dispose_m4885C0398AAF0530CA6A68D5091E8DB32D2E46C5_AdjustorThunk','_NativeArray_1_Dispose_m984934FFA03C24C01CC18A7BCA2FFBD0F0DA1DA3_AdjustorThunk','_Enumerator_Dispose_m318455880526279190ECB32DA860A9249F69FD7F_AdjustorThunk','_NativeArray_1_Dispose_m5529F065CEB4C382263420AB8E7B3FC8C52187EB_AdjustorThunk','_Enumerator_Dispose_m9EFC7EEB304EF10B4AD821E0FBDA8A3FE6AB42BE_AdjustorThunk','_NativeArray_1_Dispose_m995004A5C049781A44A7186C6EFD7702B3B9F7D4_AdjustorThunk','_Enumerator_Dispose_m1B9E807404C5993D6C9CD5BF528953D0BFBAE696_AdjustorThunk','_NativeArray_1_Dispose_mDE16B5AD7451283BC1785200DE3331B4AE29B4AA_AdjustorThunk','_Enumerator_Dispose_m674FDF5A79161C08690214F25E054ED64DCF3575_AdjustorThunk','_NativeArray_1_Dispose_m9A0B3E477E93C385E8DAE30D0B677518B2B2D65A_AdjustorThunk','_Enumerator_Dispose_mFF0557EEA2FA62B5BFD198D3545AEA97D087914D_AdjustorThunk','_NativeArray_1_Dispose_m4FCADF326882DB1D17102F37ACBDD68F54D395E5_AdjustorThunk','_Enumerator_Dispose_m385FEF6C22CB91C7112CB573B689FA3FE193F0C2_AdjustorThunk','_NativeArray_1_Dispose_m9CC9DA12EF1F8E5A99AB222A442DA1895FCAEE99_AdjustorThunk','_Enumerator_Dispose_m949003006330D3FE814AC8030CBFBB10F1B67B50_AdjustorThunk','_NativeArray_1_Dispose_mD32E7ECA16D246CFFBD5F417DAC4641733BBCB56_AdjustorThunk','_Enumerator_Dispose_m0D12CB550D2363576340A749FC751313612FACEA_AdjustorThunk','_NativeArray_1_Dispose_m1D153648AEC31953E6D00D2275443DCA74CD509B_AdjustorThunk','_Enumerator_Dispose_mB265BAF1307AAD3B4D4B55F821A7C6A500911864_AdjustorThunk','_NativeArray_1_Dispose_mF459AB9B83BB1DA41A9508A3CBF42D40BD63E97F_AdjustorThunk','_Enumerator_Dispose_mCF564D0D5728236F6F0752B9D3B72286C86B04EA_AdjustorThunk','__ZN10__cxxabiv116__shim_type_infoD2Ev','__ZN10__cxxabiv117__class_type_infoD0Ev','__ZNK10__cxxabiv116__shim_type_info5noop1Ev','__ZNK10__cxxabiv116__shim_type_info5noop2Ev','__ZN10__cxxabiv120__si_class_type_infoD0Ev','_GC_null_finalize_mark_proc','_GC_unreachable_finalize_mark_proc','__ZN5Unity4Tiny2IOL9OnSuccessEP18emscripten_fetch_t','__ZN5Unity4Tiny2IOL7OnErrorEP18emscripten_fetch_t','__ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_vii = [0,'_F_E_Invoke_m924C7BED2D76CAAB6141736C0AF99B10B11D2275','_ComponentSystem_OnBeforeCreateInternal_mEEDB3DB99B7E1DDE31BAAA25FC07F91AACEAB3A9','_ComponentSystemBase_OnBeforeCreateInternal_m22CAAC94BE1333F467021A8114E33F92A197B9F2','_HTMLWindowSystem_InfiniteMainLoop_mB236C8872E61C2743CB22EA5BDEE3D144633E88F','_AudioHTMLSystem_StopSource_mE4CE51178655AAA6A6A97CC5DBA9F50E4F354092','_RendererGLES2System_BeginScene_mAF717179A822F9CB212B4C0CF75B259C2F62CFED','_RendererGLES2System_EndCamera_m4A867D93C9E174D9E5D097C9DB157CB00A9629C3','_RendererCanvasSystem_BeginScene_mA23969709E30446CA8614B98E4FF506D338A63C0','_RendererCanvasSystem_EndCamera_mB4BFF294FB884F7D5AC83E22AF29423409CD76D1','_MakeEntryShape_Filter_m3F810EC57AA5E7C4FAE922600F1780AB842526BE','_MakeEntryShape_Update_m64A4DB70B08B2DE1DC88D598D13C3DCC0D4ABEFD','_F_D_1_Invoke_m88C648B100131625EB555C46F2F76347D8A11F82','_MakeEntryText_Filter_m34197169825A0CEE9ED54FBD8F58501229FF3450','_MakeEntryText_Update_mA9C03F30D08322117DB9884F750F48AA6E2C1304','_MakeEntrySprite_Filter_m54D94D0E659FB5EEF2D32F33FA598698DC26C2FA','_MakeEntrySprite_Update_m7A6CC9D3B4B41CC53FFF4314634E81234BFEF6AC','_MakeEntrySortingGroup_Filter_m58D106B35739897588588689A9E6B22974657EA6','_MakeEntrySortingGroup_Update_m38BA4BDAAE5974571D6C69E2D5B4A867DEAF03A8','_F_D_1_Invoke_mE19B900CF8F72A1EC1963852B7D751522BD5EF5C','_RemapArchetypesJob_Execute_m0BED77B4B257E82B198B9CE96D0A8345D50BCD13_AdjustorThunk','_GatherChunks_Execute_mE9D4AB23DAEF9FB9228D20904E94BDC055E66357_AdjustorThunk','_JoinChunksJob_Execute_m508344BAD6C21FD81DD12EA8897448F800E72574_AdjustorThunk','_CopyBlittableChunkData_Execute_m867F99CCE49A68BB9BC4DE429701AF253E5961FE_AdjustorThunk','_RemapAllChunksJob_Execute_m68C6F03C22F7EFADE747E2CACB66A4919D737A22_AdjustorThunk','_GatherChunksWithFiltering_Execute_mA6497BAF2946930B0D90B6799514AB19795419DD_AdjustorThunk','_Enumerator_get_Current_mB673C6AF7DFEF98F376873100E0238C2DF9B4FAA_AdjustorThunk','_Enumerator_get_Current_m9233F1071FB58219970A54AEC18E10143BF40E3E_AdjustorThunk','_Enumerator_get_Current_m410B4E22F6BE72FAFA2FD6C874CA7B6DE69E3603_AdjustorThunk','_Enumerator_get_Current_m4DDED61E83B79B5B3F93F9118FF450DC4331E54B_AdjustorThunk','_Enumerator_get_Current_mD60A35F69C0E53C63AAE6E50F85646AF31026F71_AdjustorThunk','_Enumerator_get_Current_m79FA1C20E3C5D331C76D92A05403F46D9D41C1A3_AdjustorThunk','_Enumerator_get_Current_m3CC7B9372A68E00C4C76D3388BE72D3946CB524B_AdjustorThunk','_Enumerator_get_Current_m005980142162981DCDD94D83C2AAEFC118605CF2_AdjustorThunk','_Enumerator_get_Current_m46F32FC8FE620261158174DA66AD92295469CD68_AdjustorThunk','_Enumerator_get_Current_m57E54536866A26D05382677771AD7500F5604C78_AdjustorThunk','_Enumerator_get_Current_m3610BE94BC51814051AF6239260A4B5E7AFFA9F1_AdjustorThunk','_Enumerator_get_Current_m9C9529F2461D122A7BC7E4CCCC4D0B11F96A08CF_AdjustorThunk','_Enumerator_get_Current_m57BC7EAF49F6C76628CBDBA57DA1076E695A952D_AdjustorThunk','_Enumerator_get_Current_m4D0498C25809D5EA48B32B83C0A4F97CD2DD036B_AdjustorThunk','_Enumerator_get_Current_mCA9A112B13D58905777AF039050DD00A13CACE7E_AdjustorThunk','_Enumerator_get_Current_mC39DF6902E5EA0B1A240ECBC8B6BD59213D46C6E_AdjustorThunk','_Enumerator_get_Current_m70496A5F65B3E4FD2F381A90A6F46D318015308F_AdjustorThunk','_Enumerator_get_Current_m1CE1E3AD7B6B23B03CADA4198DA2A7B7343CEB98_AdjustorThunk','_Enumerator_get_Current_mF008CA7EBB0E24A27DD435BDA167EBBB936D3D13_AdjustorThunk','_Enumerator_get_Current_m474BF5A605534782CC6A55F54D6D0BA42B62516B_AdjustorThunk','_Enumerator_get_Current_m4B2B250E5192DA33A6AC23959141BB8747E94FCB_AdjustorThunk','_Enumerator_get_Current_m0D7A90E78A82337BD04D92CFFBB472991F1CD4BC_AdjustorThunk','_Enumerator_get_Current_mE0C24AE8C69A3C0F4B6BBFB498DC0F62C7CFEA2A_AdjustorThunk','_Enumerator_get_Current_mFB424682DB8A7FA464A75947A37F5FC8B479EBE3_AdjustorThunk','_Enumerator_get_Current_m4C4E34C8B722838C7C9E3BA90F624BE2C70FEA59_AdjustorThunk','_Enumerator_get_Current_m1AE035DD9C9A8CE63564FD584C04B8F81198939D_AdjustorThunk','_Enumerator_get_Current_m7AF9318BC9898AD0C77CFBCD1F22F8C1D5069B07_AdjustorThunk','_Enumerator_get_Current_mE6433C8E30A234D23C5B39C4A16FE67C42FB2EBE_AdjustorThunk','_Enumerator_get_Current_m210021F27F6178292555ED392FBD03EDA9601EC2_AdjustorThunk','_Enumerator_get_Current_mB25B1B7740144305DDD7FE8BCFCC5341FADED580_AdjustorThunk','_Enumerator_get_Current_mA0424563491DF221892DF092BEC05C4B19A5012B_AdjustorThunk','_Enumerator_get_Current_m3544424FCEB07BC2AB95DBE0D19244A3EB048B2F_AdjustorThunk','_Enumerator_get_Current_m6E0C4E65A74D8490CE61F334FF4109546C91BED0_AdjustorThunk','_Enumerator_get_Current_mA10E6D9D1A8BAFCBEE6130FBF020B1F461005FF0_AdjustorThunk','_Enumerator_get_Current_m2C41E76BD30B15ACC83F2F02D31E5A865EAE62AC_AdjustorThunk','_Enumerator_get_Current_m6F45BFC9DE93E5647BA6907BF6D69283ECF9818B_AdjustorThunk','_Enumerator_get_Current_m0CDE844959AA1B8C4364B539A83C1F2794B19B4F_AdjustorThunk','_Enumerator_get_Current_m1A058D02953994B96AE237D77E4AE14E2507E7E9_AdjustorThunk','_Enumerator_get_Current_mBB7C5EFC7737FA19CB9179FC34A746F76966F6CD_AdjustorThunk','_Enumerator_get_Current_m4269772B3E506FE2D936426F7E3E6056BFE6ADED_AdjustorThunk','_Enumerator_get_Current_mAA5F56ACEEE8F58E8F64592D88576F9A82B09679_AdjustorThunk','_Enumerator_get_Current_m18DE326AC84581DFD7B41C93F059E3C67451D362_AdjustorThunk','_Enumerator_get_Current_m0A0F199F9C3B82268EB37CDB87116BEAA7297CB5_AdjustorThunk','_Enumerator_get_Current_mE715F3216FD4034E181543E779C8FA68C9F78118_AdjustorThunk','_Enumerator_get_Current_mF1EF3A87E58D77EA85C3068447F3BDFAAD3D06E8_AdjustorThunk','_Enumerator_get_Current_m7274715BE0439E30B736E518A60F95E7DEA1DB41_AdjustorThunk','_Enumerator_get_Current_m31B2736AF249568CA4435097CDE9986652A633C0_AdjustorThunk','_Enumerator_get_Current_m74B5DD55C69C0CAD813CA811388E3A4A5B0CE71A_AdjustorThunk','_Enumerator_get_Current_mDB72F3E4B5D74ED7E2160185BDD51710733824F0_AdjustorThunk','_Enumerator_get_Current_m735DD15C797DF44D960684057425622E2140C13E_AdjustorThunk','_Enumerator_get_Current_mA488F91F019EAD929A2B8BCF88875ACBBE64A79D_AdjustorThunk','_Enumerator_get_Current_m0DF62BA67384545039E9302D721BE2D53D770045_AdjustorThunk','_Enumerator_get_Current_m60E1398F27544A587DE4AF79348DC91C4264CAE1_AdjustorThunk','_Enumerator_get_Current_mD4B16A971A89C4EFA6599B8572F857A15E7C6807_AdjustorThunk','_Enumerator_get_Current_m870D013396912611767AF4A63491CB2FDDD49E8B_AdjustorThunk','_Enumerator_get_Current_mCA337FB5BA261686910970002A30AC42E5E2789D_AdjustorThunk','_Enumerator_get_Current_m63C76E7EB28479EE0003C8F07D1CCBBD01DA09AD_AdjustorThunk','_Enumerator_get_Current_m75E20235450ED326EA28CDBDAEC1F289EE3070D8_AdjustorThunk','_Enumerator_get_Current_m54205600F9015273C6AC3FC64E0E4038E40654F3_AdjustorThunk','_Enumerator_get_Current_m3DB4D08F4B06395B5668D50F8BAFCC51703C7757_AdjustorThunk','_Enumerator_get_Current_m5E9C6DAFE0BFCEDBA55BEA2F5A8CAA8C679B3136_AdjustorThunk','_GC_default_warn_proc','_U3CU3Ec__DisplayClass6_0_2_U3CAddMissingComponentU3Eb__0_m661CB6ED5F660044C7569B1DBE699E6CE64B6310','_U3CU3Ec__DisplayClass6_0_2_U3CAddMissingComponentU3Eb__0_mD86F7E0E4B719AC9F0C4DF415650D01844979A7D','_U3CU3Ec__DisplayClass6_0_2_U3CAddMissingComponentU3Eb__0_m73A865B29C008BC7E810A5F767DC0E0EFB7B60AD','_U3CU3Ec__DisplayClass6_0_2_U3CAddMissingComponentU3Eb__0_mBE74BA0ED8C0AFA7529AB06ADD2D3AC9F832565F','_U3CU3Ec__DisplayClass2_0_U3CGetTouchWorldPositionU3Eb__0_mFE7C7B2D4B9833212D9B1FFAAFBF1424277F4C95_inline','_U3CU3Ec__DisplayClass0_1_U3COnUpdateU3Eb__2_mCBE48F9ACE7D955884C1A6B9BDB7040D247682C1_inline','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mE59AB55B508DCE5820B13FE9908C1B822421151E_inline','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mD0C4973DBC6E20E4EA795CB80620C89A8D202D93_inline','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mB3550E56A35C5D9F9C83B29056E269794E38CF0F_inline','_U3CU3Ec__DisplayClass18_0_U3COnUpdateU3Eb__0_m499767FCE76CC4ABBCAC8941EA42BC92F105B8CE','_U3CU3Ec__DisplayClass18_0_U3COnUpdateU3Eb__1_m5E56EDDD876D4B481E48749E674A4D0C35BAB94B','_U3CU3Ec__DisplayClass18_0_U3COnUpdateU3Eb__2_m54FC7D1395AF5EA29D6D384490FF5AB98AA7B95D','_U3CU3Ec__DisplayClass18_0_U3COnUpdateU3Eb__3_mC472A7577EE590B6B082AB85B9FDD7DB7A2A83BF','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__0_m123A70762A86FDF912FDCDB88A6396038E9ADFCC','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__1_m5E235B137E0708F3CF175964BB18973D108AF3D3','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__2_mE93118C8B4D7773D29B1B81B7B7AAF2D96FA8C71','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__3_mDF3AD5335F3827CDCF1A2DD62785849E5A76977E','_U3CU3Ec_U3COnUpdateU3Eb__1_4_m6DEEAD3EBE0201DC854C8E5F1D1C3F1B1CCB6A86','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m6161B2A43D47876E6A88F69184AC5B870520531C','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__2_m33ED0779A127C39272EE80A38FF947821CB8A376','_U3CU3Ec__DisplayClass1_0_U3CUpdateMasksU3Eb__0_m8A255E1C137CAE9190C26BBC520DFF4905B4B643','_U3CU3Ec__DisplayClass1_0_U3CUpdateMasksU3Eb__1_m8FD5059CFBD25A4BA6FCBE78322DB4F31B95B770','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_m239A1087057F552F2A03049FA5BA7DAE305100FE','_U3CU3Ec__DisplayClass8_0_U3COnUpdateU3Eb__1_m6DA0DCCE933382BB3B08318468F203F24A07448D','_U3CU3Ec__DisplayClass8_0_U3COnUpdateU3Eb__2_mE888BAF6A85474A4F451493464397675AC7C281D','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m23A2987C6C1439E1C25B49B9D6EA6037C6220412','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_m49776FDD1D0C98F309993E6D918B90620A1FEF5E','_U3CU3Ec__DisplayClass18_0_U3CAddImage2DES2GLComponentU3Eb__0_m7E2EDC94C9522A2BC657636A0D114DB568926F85','_U3CU3Ec__DisplayClass6_0_U3CGetUICameraU3Eb__0_mDB0696E6AC527D70B8FE7C7716008DB1EE502156','_U3CU3Ec_U3COnUpdateU3Eb__0_0_mF1A4C254D45C29765E4B5C15C9BEAB7450B55A20','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mFE84ECFD567CE692F30D238EAAFE11B1769F5136',0,0,0,0,0,0,0,0,0];
var debug_table_viii = [0,'_RendererGLES2System_BeginCamera_mD86EF2139B5D536EB72C12246CA5CC23DD44BBC6','_RendererGLES2System_BeginRTT_mD0BAC5731635D2C65CFB978FEC9222C4EE38880E','_RendererGLES2System_EndRTT_m72A8825904FDE7D52D94166E854558AD6096971A','_RendererGLES2System_RenderSpriteBatch_mC54EAF3A5D3847CE03213122E19CFBF78544EA17','_RendererCanvasSystem_BeginCamera_mA4812E00292D4F3C6ECB68F6988A5549D885A5EB','_RendererCanvasSystem_BeginRTT_mD352181C60C14B36454E041388FD48CAF827285E','_RendererCanvasSystem_EndRTT_m8A3F1461481ADD8F59969EB7178E981999F7EB8A','_RendererCanvasSystem_RenderSpriteBatch_m64BD6EA9A1201FEE0B8719FE2C359EA75BD6F125','_MemoryBinaryReader_ReadBytes_m9A9DAA8FF197677E4D99AC8CEF999E6EA4E45AD8','_F_DD_2_Invoke_mA0185E10D2509AE0C576B3F5E90FB211D7ABCC6E','_F_DD_2_Invoke_m9F0C8BA9165D1B7229EC188480C379EFB806321D','_F_DD_2_Invoke_m2D731B0FEC97075BAA54D0B3609727884A336DCE','_F_DD_2_Invoke_mB934AC3EB50860E00F16CAA3911DB766479140BE','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__0_m0522CB7281A67E5CD29E827008EF0CE7374858E0','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__1_m5D1165A05A359D483E35C5134563997D181B959E','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__0_mC5AB5E80DF97ED962DC6FCDBB4EEFBF645AB5E2C','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__1_m8FD39CEA0EB0A851440950EC54AC5BB4DB461914','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m22797D56EBF163D75DDE7A0CF0F4953EA2962F43','_U3CU3Ec__DisplayClass1_0_U3CIsConnectedU3Eb__0_m53C7F40ED7DD668694AAEDB2FF1BB8F7D48662C0','_AudioSystem_U3COnUpdateU3Eb__7_0_m61A9A9026D6CCB5177E9A302F0A614ACBC23A2AA','_AudioSystem_U3COnUpdateU3Eb__7_1_m22679CA133E2A7C33A57BA8A7E3B179C520F5ECA','_AudioSystem_U3COnUpdateU3Eb__7_2_mF48C826F8CC6C901FEDC5BF082A0794EF5238F72','_U3CU3Ec_U3COnUpdateU3Eb__1_5_m4EE17C76259D72F3923CE98DB618E0B466EA2E32','_U3CU3Ec_U3COnUpdateU3Eb__1_6_mEF97BF32C7334DCB4C25D83B73B1D7E57898CE23','_U3CU3Ec_U3COnUpdateU3Eb__1_7_m47FBAE3FBAA74E6679458275CC0D360EB65C85B3','_U3CU3Ec_U3COnUpdateU3Eb__1_8_mFCE248CC8D487A0B529EF987B57EE2DEFF852E1F','_U3CU3Ec__DisplayClass8_0_U3COnUpdateU3Eb__0_m5D0E28F8F4668E6EC7C567A7BF4294C39D7D0FBD','_RendererCanvasSystem_U3CBeginSceneU3Eb__12_0_mC5CBE3C81577D8E62C68F9513BCF8B96BC51B31D','_RendererCanvasSystem_U3CBeginSceneU3Eb__12_1_m20D3E2EC429BDEFEAED15F62C6A56E196E7AD910','_RendererCanvasSystem_U3CBeginSceneU3Eb__12_2_mCF71DB38F42C48423BCE17210876942A33E68924','_RendererCanvasSystem_U3CBeginSceneU3Eb__12_3_mF89D6FAE4D65288CD56FE516148A6FDA1BFFA514','_U3CU3Ec__DisplayClass18_0_U3CAddImage2DES2GLComponentU3Eb__1_mD7635B59D1280AE0FD1DF616B601CB1F838B6E13','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m63A02594A5F1B81CE98203E8B39A75C343EE4055','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m9759E1C9B3E2D0E8AC5B569E3982C30F63BF8E9E','_EntityManagerDelegates_CallAddComponentRaw_mFACF781D6347D662B3D2FAE8B45547285A7351EA','_ReversePInvokeWrapper_EntityManagerDelegates_CallAddComponentRaw_mFACF781D6347D662B3D2FAE8B45547285A7351EA','_EntityManagerDelegates_CallRemoveComponentRaw_mEB1533FE655E96914A396FD3E421952B4E91CB95','_ReversePInvokeWrapper_EntityManagerDelegates_CallRemoveComponentRaw_mEB1533FE655E96914A396FD3E421952B4E91CB95','_EntityManagerDelegates_CallCreateEntity_mB37863C604736208FAFD79FEDB497FA729DFF173','_ReversePInvokeWrapper_EntityManagerDelegates_CallCreateEntity_mB37863C604736208FAFD79FEDB497FA729DFF173','_EntityManagerDelegates_CallDestroyEntity_mC45D9112E691956205A1ECF7B6B7319979EFB567','_ReversePInvokeWrapper_EntityManagerDelegates_CallDestroyEntity_mC45D9112E691956205A1ECF7B6B7319979EFB567',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_viiii = [0,'_AddComponentRawType_Invoke_m083E6EFE11B251112665CEC5D45BB46875052315','_RemoveComponentRawType_Invoke_m995E9DB3C3975CB9CD27DD8BBC021DA61B09DC94','_CreateEntityType_Invoke_m238852CC7A9C748993F27732600A31DC3B9D5C7C','_DestroyEntityType_Invoke_m5DABCAFB8278A1851F28BDBEA302F5E017870746','_F_EDD_2_Invoke_mF6F42A6AAD7BE2555862BA544867A2751B070F04','_F_EDD_2_Invoke_mE708A68C621AC593C72D73BE4B047873FE928332','_Image2DIOHTMLLoader_FreeNative_m64328D61B1B1D3701FAB3880AE1C743AEB0258EB','_F_DDD_3_Invoke_m7FBAFE127A1C209009751935CB0C2D7D5908F41C','_F_DDD_3_Invoke_mB7419741FA7E0AB32FC51BA39109E46FEF355E46','_F_DDD_3_Invoke_m80C91B0D1EB200C673BEDB25D39D89421D1CB2A9','_F_DDD_3_Invoke_m850F35379CF2E68EA4F0B1D34C09D86D04BD981D','_F_DDD_3_Invoke_m52EB8F544210A5B7BC43AE0CB70B02304E66CE76','_AudioHTMLSystemLoadFromFile_FreeNative_m334A75DB2AD54C7C2B033B2E662584FC852A646D','__ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi','__ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__1_m506C8308696AD1276B10BACFCAE5F7A66A777BC2','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m56778E16566DF5F8D2EC01BB4C74BDA056034C39','_U3CU3Ec_U3COnUpdateU3Eb__0_1_mD0328C2493D1C0AEC656B642E8EEBF4FFCBC764E','_U3CU3Ec__DisplayClass1_0_U3CMoveCursorU3Eb__0_m00549530D2FB90A8D9B5CC13629D9F56C0F40D2B','_U3CU3Ec__DisplayClass13_0_U3CAddItemsToListByTypeU3Eb__0_m7C02FF061E54BE40A535D37D5A62A3ED5FC52F66','_U3CU3Ec_U3COnUpdateU3Eb__1_9_mE4DE1DC86EAA528B638B1491671EF08C5C079539','_U3CU3Ec_U3COnUpdateU3Eb__1_10_m86B6F36B054B261D2F808116D664C89F6DAD6CCD','_U3CU3Ec_U3COnUpdateU3Eb__1_11_mCDB77DA9FF6CDD23A48635D4023EA1F8484B7FE1','_U3CU3Ec_U3COnUpdateU3Eb__1_12_m75EB23672C1AC8487CEA14695433956B849068F8','_U3CU3Ec_U3COnUpdateU3Eb__1_13_mD337F85C0B91310602EA6E80A2070F6CCCF053E2','_U3CU3Ec__DisplayClass13_0_U3CTranslateScreenToWorldU3Eb__0_m84561505CF0083D2998A85929177125BC802A648','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mA7D1F791856D95089E98CD408FFF07362CF25FF9','_U3CU3Ec__DisplayClass8_0_U3COnUpdateU3Eb__3_mA1E35A507417B0DDA8613A5295C08F6F677662AC','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__0_mC97DA1110FAD1AF37703E69F5601AB137A43A053','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__2_m4AB79689743C5DC3F3AD5B692F4FA95AB283EDBA','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_mC44F6910D09650EBE904F08F93EDD13BB39913F5','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__2_m3C16FC4B98DC1A9A0B919F1CBE1312816A6634F4','_U3CU3Ec__DisplayClass16_0_U3COnUpdateU3Eb__0_m7397DF392D7F790A2B9D96FF0F7C6D2822DC0AB7','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__1_mC3297492A3A4FE5B0D41E6ACA077DD7CA0D7A43C','_U3CU3Ec_U3COnUpdateU3Eb__0_0_mD100852B886F6C7A5F1336299514B8C694519845','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__1_mF3C7EAB14FF28A38BB62ADCF2DD5F515351541DB','_SetRectTransformSizeSystem_U3COnUpdateU3Eb__0_0_m39BCCF375C864980BFB4A074672147FDFAD41A44',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_viiiii = [0,'_F_DDDD_4_Invoke_mD01C06829BE243A928E3A85ABD875A6AA861D757','_F_DDDD_4_Invoke_m5D64E35D24E6BCAF8163DD0AD88A991B1D9D4D7A','__ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib','__ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__2_mB95FEFAE6CC560B4115BA50D9B600A88ECFEC274','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__2_mC78D320CD16F1F27F91AD1F69BF421DF3D128897','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mFC938B020BAEBB091E989DAE3205C2F656354719','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mBA607B730860575645EA9A0F08AC805185651B86','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m7350D558EB056EE6280B8207FDE0917D7469DE53','_U3CU3Ec__DisplayClass18_0_U3COnUpdateU3Eb__4_m52F70E3CB7EA5F4274C0FB9B2FC98264427F8FB6','_U3CU3Ec_U3COnUpdateU3Eb__1_14_m49614456B6F00A9B919C728703AAE962AAE49573','_U3CU3Ec_U3COnUpdateU3Eb__1_15_m2952C840AAA8AF44068D23463C470630530651DD','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__1_mAEA1FBB278B593994F15E0C54EC3655F9AE44EBD','_UILayoutSystem_U3COnUpdateU3Eb__0_0_m9DEF598E2FE68D6BAEA322D064BDE2F081DFF2AE',0];
var debug_table_viiiiii = [0,'_Image2DIOHTMLLoader_FinishLoading_m4B38D08DA505A78C6BBE2CE0F14509EC87484455','_AudioHTMLSystemLoadFromFile_FinishLoading_mA0A010B9C36076F9AE15D86D9A79F58EBBA8D946','__ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib','__ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__3_mAE2CEBBCCC2174B8663B66A097AF88A0D02B6BBC','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__3_m592F2D301979393DEFD4DF4A5B70704023C7EBD3','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_mD362AFBD5989262BC9B7082EB5D064B8ACCF5452','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__1_mC03755D8C37B8B4A858AE98D909B627ED81C5CCE','_SetSprite2DSizeSystem_U3COnUpdateU3Eb__0_0_mDA0A5DD5F3D13C156C1396D5045F234487D58E1F','_U3CU3Ec__DisplayClass4_0_U3COnUpdateU3Eb__0_m676738CDF671386234A3E43A53E4AE22EDB0DD92',0,0,0,0,0];
var debug_table_viiiiiii = [0,'_Image2DIOHTMLLoader_StartLoad_mF7234E43DF2D684E2640D129FDB28A04D8506F57','_AudioHTMLSystemLoadFromFile_StartLoad_mB1559A2845F8082D3DE1C5E2BB6765AD95658AF6','_SendMessageHandler_OnSendMessage_m8A610D8867DEF88A4C63590BAEEDFAE8937723B4','_ReversePInvokeWrapper_SendMessageHandler_OnSendMessage_m8A610D8867DEF88A4C63590BAEEDFAE8937723B4',0,0,0];
var debug_table_viiiiiiii = [0,'_RegisterSendMessageDelegate_Invoke_mE40930E741B48121161AA6DD0334F942D1757BEF'];
var debug_tables = {
  'fi': debug_table_fi,
  'i': debug_table_i,
  'idi': debug_table_idi,
  'ii': debug_table_ii,
  'iii': debug_table_iii,
  'iiii': debug_table_iiii,
  'iiiii': debug_table_iiiii,
  'iiiiiiiii': debug_table_iiiiiiiii,
  'iij': debug_table_iij,
  'ij': debug_table_ij,
  'ji': debug_table_ji,
  'v': debug_table_v,
  'vi': debug_table_vi,
  'vii': debug_table_vii,
  'viii': debug_table_viii,
  'viiii': debug_table_viiii,
  'viiiii': debug_table_viiiii,
  'viiiiii': debug_table_viiiiii,
  'viiiiiii': debug_table_viiiiiii,
  'viiiiiiii': debug_table_viiiiiiii,
};
function nullFunc_fi(x) { abortFnPtrError(x, 'fi'); }
function nullFunc_i(x) { abortFnPtrError(x, 'i'); }
function nullFunc_idi(x) { abortFnPtrError(x, 'idi'); }
function nullFunc_ii(x) { abortFnPtrError(x, 'ii'); }
function nullFunc_iii(x) { abortFnPtrError(x, 'iii'); }
function nullFunc_iiii(x) { abortFnPtrError(x, 'iiii'); }
function nullFunc_iiiii(x) { abortFnPtrError(x, 'iiiii'); }
function nullFunc_iiiiiiiii(x) { abortFnPtrError(x, 'iiiiiiiii'); }
function nullFunc_iij(x) { abortFnPtrError(x, 'iij'); }
function nullFunc_ij(x) { abortFnPtrError(x, 'ij'); }
function nullFunc_ji(x) { abortFnPtrError(x, 'ji'); }
function nullFunc_v(x) { abortFnPtrError(x, 'v'); }
function nullFunc_vi(x) { abortFnPtrError(x, 'vi'); }
function nullFunc_vii(x) { abortFnPtrError(x, 'vii'); }
function nullFunc_viii(x) { abortFnPtrError(x, 'viii'); }
function nullFunc_viiii(x) { abortFnPtrError(x, 'viiii'); }
function nullFunc_viiiii(x) { abortFnPtrError(x, 'viiiii'); }
function nullFunc_viiiiii(x) { abortFnPtrError(x, 'viiiiii'); }
function nullFunc_viiiiiii(x) { abortFnPtrError(x, 'viiiiiii'); }
function nullFunc_viiiiiiii(x) { abortFnPtrError(x, 'viiiiiiii'); }

var asmGlobalArg = {}

var asmLibraryArg = {
  "abort": abort,
  "setTempRet0": setTempRet0,
  "getTempRet0": getTempRet0,
  "nullFunc_fi": nullFunc_fi,
  "nullFunc_i": nullFunc_i,
  "nullFunc_idi": nullFunc_idi,
  "nullFunc_ii": nullFunc_ii,
  "nullFunc_iii": nullFunc_iii,
  "nullFunc_iiii": nullFunc_iiii,
  "nullFunc_iiiii": nullFunc_iiiii,
  "nullFunc_iiiiiiiii": nullFunc_iiiiiiiii,
  "nullFunc_iij": nullFunc_iij,
  "nullFunc_ij": nullFunc_ij,
  "nullFunc_ji": nullFunc_ji,
  "nullFunc_v": nullFunc_v,
  "nullFunc_vi": nullFunc_vi,
  "nullFunc_vii": nullFunc_vii,
  "nullFunc_viii": nullFunc_viii,
  "nullFunc_viiii": nullFunc_viiii,
  "nullFunc_viiiii": nullFunc_viiiii,
  "nullFunc_viiiiii": nullFunc_viiiiii,
  "nullFunc_viiiiiii": nullFunc_viiiiiii,
  "nullFunc_viiiiiiii": nullFunc_viiiiiiii,
  "___cxa_begin_catch": ___cxa_begin_catch,
  "___exception_addRef": ___exception_addRef,
  "___exception_deAdjust": ___exception_deAdjust,
  "___gxx_personality_v0": ___gxx_personality_v0,
  "___setErrNo": ___setErrNo,
  "___syscall140": ___syscall140,
  "___syscall146": ___syscall146,
  "___syscall4": ___syscall4,
  "___syscall54": ___syscall54,
  "___syscall6": ___syscall6,
  "__emscripten_fetch_xhr": __emscripten_fetch_xhr,
  "__emscripten_get_fetch_work_queue": __emscripten_get_fetch_work_queue,
  "__findCanvasEventTarget": __findCanvasEventTarget,
  "__findEventTarget": __findEventTarget,
  "__glGenObject": __glGenObject,
  "__maybeCStringToJsString": __maybeCStringToJsString,
  "_abort": _abort,
  "_clock": _clock,
  "_emscripten_asm_const_async_on_main_thread_v": _emscripten_asm_const_async_on_main_thread_v,
  "_emscripten_asm_const_async_on_main_thread_vdddd": _emscripten_asm_const_async_on_main_thread_vdddd,
  "_emscripten_asm_const_sync_on_main_thread_i": _emscripten_asm_const_sync_on_main_thread_i,
  "_emscripten_get_heap_size": _emscripten_get_heap_size,
  "_emscripten_is_webgl_context_lost": _emscripten_is_webgl_context_lost,
  "_emscripten_memcpy_big": _emscripten_memcpy_big,
  "_emscripten_performance_now": _emscripten_performance_now,
  "_emscripten_request_animation_frame_loop": _emscripten_request_animation_frame_loop,
  "_emscripten_resize_heap": _emscripten_resize_heap,
  "_emscripten_start_fetch": _emscripten_start_fetch,
  "_emscripten_throw_string": _emscripten_throw_string,
  "_emscripten_webgl_create_context": _emscripten_webgl_create_context,
  "_emscripten_webgl_do_create_context": _emscripten_webgl_do_create_context,
  "_emscripten_webgl_init_context_attributes": _emscripten_webgl_init_context_attributes,
  "_emscripten_webgl_make_context_current": _emscripten_webgl_make_context_current,
  "_exit": _exit,
  "_glAttachShader": _glAttachShader,
  "_glBindAttribLocation": _glBindAttribLocation,
  "_glBindBuffer": _glBindBuffer,
  "_glBindTexture": _glBindTexture,
  "_glBlendFuncSeparate": _glBlendFuncSeparate,
  "_glBufferData": _glBufferData,
  "_glBufferSubData": _glBufferSubData,
  "_glClear": _glClear,
  "_glClearColor": _glClearColor,
  "_glCompileShader": _glCompileShader,
  "_glCreateProgram": _glCreateProgram,
  "_glCreateShader": _glCreateShader,
  "_glDeleteProgram": _glDeleteProgram,
  "_glDeleteShader": _glDeleteShader,
  "_glDeleteTextures": _glDeleteTextures,
  "_glDisable": _glDisable,
  "_glDisableVertexAttribArray": _glDisableVertexAttribArray,
  "_glDrawArrays": _glDrawArrays,
  "_glDrawElements": _glDrawElements,
  "_glEnable": _glEnable,
  "_glEnableVertexAttribArray": _glEnableVertexAttribArray,
  "_glGenBuffers": _glGenBuffers,
  "_glGenTextures": _glGenTextures,
  "_glGetActiveUniform": _glGetActiveUniform,
  "_glGetProgramInfoLog": _glGetProgramInfoLog,
  "_glGetProgramiv": _glGetProgramiv,
  "_glGetShaderInfoLog": _glGetShaderInfoLog,
  "_glGetShaderiv": _glGetShaderiv,
  "_glGetUniformLocation": _glGetUniformLocation,
  "_glLinkProgram": _glLinkProgram,
  "_glPixelStorei": _glPixelStorei,
  "_glScissor": _glScissor,
  "_glShaderSource": _glShaderSource,
  "_glTexParameteri": _glTexParameteri,
  "_glUniform1i": _glUniform1i,
  "_glUniform3fv": _glUniform3fv,
  "_glUniform4fv": _glUniform4fv,
  "_glUniformMatrix3fv": _glUniformMatrix3fv,
  "_glUseProgram": _glUseProgram,
  "_glVertexAttribPointer": _glVertexAttribPointer,
  "_glViewport": _glViewport,
  "_js_canvasBlendingAndSmoothing": _js_canvasBlendingAndSmoothing,
  "_js_canvasClear": _js_canvasClear,
  "_js_canvasInit": _js_canvasInit,
  "_js_canvasMakePattern": _js_canvasMakePattern,
  "_js_canvasMakeTintedSprite": _js_canvasMakeTintedSprite,
  "_js_canvasReleaseTintedSprite": _js_canvasReleaseTintedSprite,
  "_js_canvasRenderMultipleSliced": _js_canvasRenderMultipleSliced,
  "_js_canvasRenderNormalSpriteTinted": _js_canvasRenderNormalSpriteTinted,
  "_js_canvasRenderNormalSpriteWhite": _js_canvasRenderNormalSpriteWhite,
  "_js_canvasRenderPatternSprite": _js_canvasRenderPatternSprite,
  "_js_canvasSetTransformOnly": _js_canvasSetTransformOnly,
  "_js_html_audioCheckLoad": _js_html_audioCheckLoad,
  "_js_html_audioFree": _js_html_audioFree,
  "_js_html_audioIsPlaying": _js_html_audioIsPlaying,
  "_js_html_audioIsUnlocked": _js_html_audioIsUnlocked,
  "_js_html_audioPause": _js_html_audioPause,
  "_js_html_audioPlay": _js_html_audioPlay,
  "_js_html_audioResume": _js_html_audioResume,
  "_js_html_audioStartLoadFile": _js_html_audioStartLoadFile,
  "_js_html_audioStop": _js_html_audioStop,
  "_js_html_audioUnlock": _js_html_audioUnlock,
  "_js_html_checkLoadImage": _js_html_checkLoadImage,
  "_js_html_extractAlphaFromImage": _js_html_extractAlphaFromImage,
  "_js_html_finishLoadImage": _js_html_finishLoadImage,
  "_js_html_freeImage": _js_html_freeImage,
  "_js_html_getCanvasSize": _js_html_getCanvasSize,
  "_js_html_getFrameSize": _js_html_getFrameSize,
  "_js_html_getScreenSize": _js_html_getScreenSize,
  "_js_html_init": _js_html_init,
  "_js_html_initAudio": _js_html_initAudio,
  "_js_html_initImageLoading": _js_html_initImageLoading,
  "_js_html_loadImage": _js_html_loadImage,
  "_js_html_setCanvasSize": _js_html_setCanvasSize,
  "_js_inputGetCanvasLost": _js_inputGetCanvasLost,
  "_js_inputGetFocusLost": _js_inputGetFocusLost,
  "_js_inputGetKeyStream": _js_inputGetKeyStream,
  "_js_inputGetMouseStream": _js_inputGetMouseStream,
  "_js_inputGetTouchStream": _js_inputGetTouchStream,
  "_js_inputInit": _js_inputInit,
  "_js_inputResetStreams": _js_inputResetStreams,
  "_js_measureText": _js_measureText,
  "_js_renderTextTo2DCanvas": _js_renderTextTo2DCanvas,
  "_js_texImage2D_from_html_image": _js_texImage2D_from_html_image,
  "_js_texImage2D_from_html_text": _js_texImage2D_from_html_text,
  "_llvm_trap": _llvm_trap,
  "_testBrowserCannotHandleOffsetsInUniformArrayViews": _testBrowserCannotHandleOffsetsInUniformArrayViews,
  "abortStackOverflow": abortStackOverflow,
  "flush_NO_FILESYSTEM": flush_NO_FILESYSTEM,
  "utf16_to_js_string": utf16_to_js_string,
  "warnOnce": warnOnce,
  "tempDoublePtr": tempDoublePtr,
  "DYNAMICTOP_PTR": DYNAMICTOP_PTR
}
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
    
;



// === Auto-generated postamble setup entry stuff ===

if (!Module["intArrayFromString"]) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["intArrayToString"]) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["ccall"]) Module["ccall"] = function() { abort("'ccall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["cwrap"]) Module["cwrap"] = function() { abort("'cwrap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setValue"]) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getValue"]) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocate"]) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getMemory"]) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["AsciiToString"]) Module["AsciiToString"] = function() { abort("'AsciiToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToAscii"]) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF8ArrayToString"]) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF8ToString"]) Module["UTF8ToString"] = function() { abort("'UTF8ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF8Array"]) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF8"]) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF8"]) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF16ToString"]) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF16"]) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF16"]) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF32ToString"]) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF32"]) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF32"]) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocateUTF8"]) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackTrace"]) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreRun"]) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnInit"]) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreMain"]) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnExit"]) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPostRun"]) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeStringToMemory"]) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeArrayToMemory"]) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeAsciiToMemory"]) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addRunDependency"]) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["removeRunDependency"]) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["ENV"]) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS"]) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS_createFolder"]) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPath"]) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDataFile"]) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPreloadedFile"]) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLazyFile"]) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLink"]) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDevice"]) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_unlink"]) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["GL"]) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynamicAlloc"]) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["warnOnce"]) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadDynamicLibrary"]) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadWebAssemblyModule"]) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getLEB"]) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFunctionTables"]) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["alignFunctionTables"]) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["registerFunctions"]) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addFunction"]) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["removeFunction"]) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFuncWrapper"]) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["prettyPrint"]) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["makeBigInt"]) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynCall"]) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getCompilerSetting"]) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["print"]) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["printErr"]) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getTempRet0"]) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setTempRet0"]) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };if (!Module["ALLOC_NORMAL"]) Object.defineProperty(Module, "ALLOC_NORMAL", { get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_STACK"]) Object.defineProperty(Module, "ALLOC_STACK", { get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_DYNAMIC"]) Object.defineProperty(Module, "ALLOC_DYNAMIC", { get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_NONE"]) Object.defineProperty(Module, "ALLOC_NONE", { get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });

function run() {

    var ret = _main();

  checkStackCookie();
}

function initRuntime(asm) {
  runtimeInitialized = true;


  writeStackCookie();

  asm['globalCtors']();

  
}


// Initialize wasm (asynchronous)
var env = asmLibraryArg;
env['memory'] = wasmMemory;
env['table'] = new WebAssembly.Table({ 'initial': 3162
  , 'maximum': 3162
  , 'element': 'anyfunc' });
env['__memory_base'] = STATIC_BASE;
env['__table_base'] = 0;

var imports = {
  'env': env
  , 'global': {
    'NaN': NaN,
    'Infinity': Infinity
  },
  'global.Math': Math,
  'asm2wasm': {
    'f64-rem': function(x, y) { return x % y; },
    'debugger': function() {
      debugger;
    }
  }
};

var _SendMessage,___cxa_demangle,_emscripten_is_main_browser_thread,_free,_main,_malloc,_memcpy,_memmove,_memset,_sbrk,_strlen,globalCtors,dynCall_fi,dynCall_i,dynCall_idi,dynCall_ii,dynCall_iii,dynCall_iiii,dynCall_iiiii,dynCall_iiiiiiiii,dynCall_iij,dynCall_ij,dynCall_ji,dynCall_v,dynCall_vi,dynCall_vii,dynCall_viii,dynCall_viiii,dynCall_viiiii,dynCall_viiiiii,dynCall_viiiiiii,dynCall_viiiiiiii;

// Streaming Wasm compilation is not possible in Node.js, it does not support the fetch() API.
// In synchronous Wasm compilation mode, Module['wasm'] should contain a typed array of the Wasm object data.
if (!Module['wasm']) throw 'Must load WebAssembly Module in to variable Module.wasm before adding compiled output .js script to the DOM';
Module['wasmInstance'] = WebAssembly.instantiate(Module['wasm'], imports).then(function(output) {
  var asm = output.instance.exports;

  _SendMessage = asm["_SendMessage"];
___cxa_demangle = asm["___cxa_demangle"];
_emscripten_is_main_browser_thread = asm["_emscripten_is_main_browser_thread"];
_free = asm["_free"];
_main = asm["_main"];
_malloc = asm["_malloc"];
_memcpy = asm["_memcpy"];
_memmove = asm["_memmove"];
_memset = asm["_memset"];
_sbrk = asm["_sbrk"];
_strlen = asm["_strlen"];
globalCtors = asm["globalCtors"];
dynCall_fi = asm["dynCall_fi"];
dynCall_i = asm["dynCall_i"];
dynCall_idi = asm["dynCall_idi"];
dynCall_ii = asm["dynCall_ii"];
dynCall_iii = asm["dynCall_iii"];
dynCall_iiii = asm["dynCall_iiii"];
dynCall_iiiii = asm["dynCall_iiiii"];
dynCall_iiiiiiiii = asm["dynCall_iiiiiiiii"];
dynCall_iij = asm["dynCall_iij"];
dynCall_ij = asm["dynCall_ij"];
dynCall_ji = asm["dynCall_ji"];
dynCall_v = asm["dynCall_v"];
dynCall_vi = asm["dynCall_vi"];
dynCall_vii = asm["dynCall_vii"];
dynCall_viii = asm["dynCall_viii"];
dynCall_viiii = asm["dynCall_viiii"];
dynCall_viiiii = asm["dynCall_viiiii"];
dynCall_viiiiii = asm["dynCall_viiiiii"];
dynCall_viiiiiii = asm["dynCall_viiiiiii"];
dynCall_viiiiiiii = asm["dynCall_viiiiiiii"];


    initRuntime(asm);
    ready();
})
.catch(function(error) {
  console.error(error);
})
;








// {{MODULE_ADDITIONS}}



