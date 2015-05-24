

// == UTF16-BE codec. ==========================================================

exports.utf16be = function() {
    return {
        encoder: utf16beEncoder,
        decoder: utf16beDecoder,

        bomAware: true,
    };
};


// -- Encoding

function utf16beEncoder() {
    return {
        write: utf16beEncoderWrite,
        end: function() {},
    }
}

function utf16beEncoderWrite(str) {
    var buf = new Buffer(str, 'ucs2');
    for (var i = 0; i < buf.length; i += 2) {
        var tmp = buf[i]; buf[i] = buf[i+1]; buf[i+1] = tmp;
    }
    return buf;
}


// -- Decoding

function utf16beDecoder() {
    return {
        write: utf16beDecoderWrite,
        end: function() {},

        overflowByte: -1,
    };
}

function utf16beDecoderWrite(buf) {
    if (buf.length == 0)
        return '';

    var buf2 = new Buffer(buf.length + 1),
        i = 0, j = 0;

    if (this.overflowByte !== -1) {
        buf2[0] = buf[0];
        buf2[1] = this.overflowByte;
        i = 1; j = 2;
    }

    for (; i < buf.length-1; i += 2, j+= 2) {
        buf2[j] = buf[i+1];
        buf2[j+1] = buf[i];
    }

    this.overflowByte = (i == buf.length-1) ? buf[buf.length-1] : -1;

    return buf2.slice(0, j).toString('ucs2');
}


// == UTF-16 codec =============================================================
// Decoder chooses automatically from UTF-16LE and UTF-16BE using BOM and space-based heuristic.
// Defaults to UTF-16BE, according to RFC 2781, although it is against some industry practices, see
// http://en.wikipedia.org/wiki/UTF-16 and http://encoding.spec.whatwg.org/#utf-16le
// Decoder default can be changed: iconv.decode(buf, 'utf16', {default: 'utf-16le'});

// Encoder by default uses UTF-16BE and prepends BOM.
// Endianness can be changed: iconv.encode(str, 'utf16', {use: 'utf-16le'});
// BOM can be skipped: iconv.encode(str, 'utf16', {addBOM: false});

exports.utf16 = function(codecOptions, iconv) {
    return {
        encoder: utf16Encoder,
        decoder: utf16Decoder,

        iconv: iconv,
        // bomAware-ness is handled inside encoder/decoder functions
    };
};

// -- Encoding

function utf16Encoder(options) {
    options = options || {};
    if (options.addBOM === undefined)
        options.addBOM = true;
    return this.iconv.getEncoder(options.use || 'utf-16be', options);
}

// -- Decoding

function utf16Decoder(options) {
    return {
        write: utf16DecoderWrite,
        end: utf16DecoderEnd,

        internalDecoder: null,
        initialBytes: [],
        initialBytesLen: 0,

        options: options || {},
        iconv: this.iconv,
    };
}

function utf16DecoderWrite(buf) {
    if (this.internalDecoder)
        return this.internalDecoder.write(buf);

    // Codec is not chosen yet. Accumulate initial bytes.
    this.initialBytes.push(buf);
    this.initialBytesLen += buf.length;
    
    if (this.initialBytesLen < 16) // We need > 2 bytes to use space heuristic (see below)
        return '';

    // We have enough bytes -> decide endianness.
    return utf16DecoderDecideEndianness.call(this);
}

function utf16DecoderEnd() {
    if (this.internalDecoder)
        return this.internalDecoder.end();

    var res = utf16DecoderDecideEndianness.call(this);
    var trail;

    if (this.internalDecoder)
        trail = this.internalDecoder.end();

    return (trail && trail.length > 0) ? (res + trail) : res;
}

function utf16DecoderDecideEndianness() {
    var buf = Buffer.concat(this.initialBytes);
    this.initialBytes.length = this.initialBytesLen = 0;

    if (buf.length < 2)
        return ''; // Not a valid UTF-16 sequence anyway.

    // Default encoding.
    var enc = this.options.default || 'utf-16be';

    // Check BOM.
    if (buf[0] == 0xFE && buf[1] == 0xFF) // UTF-16BE BOM
        enc = 'utf-16be';
    else if (buf[0] == 0xFF && buf[1] == 0xFE) // UTF-16LE BOM
        enc = 'utf-16le';
    else {
        // No BOM found. Try to deduce encoding from initial content.
        // Most of the time, the content has spaces (U+0020), but the opposite (U+2000) is very uncommon.
        // So, we count spaces as if it was LE or BE, and decide from that.
        var spaces = [0, 0], // Counts of space chars in both positions
            _len = Math.min(buf.length - (buf.length % 2), 64); // Len is always even.

        for (var i = 0; i < _len; i += 2) {
            if (buf[i] == 0x00 && buf[i+1] == 0x20) spaces[0]++;
            if (buf[i] == 0x20 && buf[i+1] == 0x00) spaces[1]++;
        }

        if (spaces[0] > 0 && spaces[1] == 0)  
            enc = 'utf-16be';
        else if (spaces[0] == 0 && spaces[1] > 0)
            enc = 'utf-16le';
    }

    this.internalDecoder = this.iconv.getDecoder(enc, this.options);
    return this.internalDecoder.write(buf);
}


